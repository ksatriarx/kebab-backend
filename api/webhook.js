import crypto from 'crypto';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const data = req.body;
    const serverKey = process.env.MIDTRANS_SERVER_KEY ? process.env.MIDTRANS_SERVER_KEY.trim() : '';
    
    const projectId = 'kebab-idi';
    const apiKey = 'AIzaSyCceiYONY_sx9ivD0CDDQGoB9OXm05h4CY';

    try {
        const orderIdStr = String(data.order_id);
        const statusCodeStr = String(data.status_code);
        const grossAmountStr = parseFloat(data.gross_amount).toFixed(2);
        
        const signatureInput = `${orderIdStr}${statusCodeStr}${grossAmountStr}${serverKey}`;
        const hash = crypto.createHash('sha512').update(signatureInput).digest('hex');

        // ==========================================
        // CCTV DEBUGGING: KIRIM DATA KE FIREBASE
        // ==========================================
        const debugUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/debug_webhook?key=${apiKey}`;
        await fetch(debugUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fields: {
                    order_id: { stringValue: orderIdStr },
                    gross_amount_asli: { stringValue: String(data.gross_amount) },
                    gross_amount_diolah: { stringValue: grossAmountStr },
                    server_key_panjang: { integerValue: serverKey.length },
                    server_key_awal: { stringValue: serverKey.substring(0, 10) }, // Cek 10 huruf pertama
                    server_key_akhir: { stringValue: serverKey.slice(-5) },       // Cek 5 huruf terakhir
                    hash_kita: { stringValue: hash },
                    hash_midtrans: { stringValue: data.signature_key },
                    waktu: { timestampValue: new Date().toISOString() }
                }
            })
        });
        // ==========================================

        if (hash !== data.signature_key) {
            console.error("❌ SIGNATURE TIDAK COCOK!");
            return res.status(401).json({ message: 'Signature tidak valid' });
        }

        console.log("✅ Signature Valid. Memproses data...");

        if (data.order_id.startsWith('TOPUP-')) {
            if (data.transaction_status === 'settlement' || data.transaction_status === 'capture') {
                const email = data.customer_details.email;
                const emailKey = email.replace(/[^a-zA-Z0-9]/g, ""); 
                const orderId = data.order_id;
                const nominal = parseFloat(data.gross_amount);

                const cekRiwayatUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/riwayat_topup/${orderId}?key=${apiKey}`;
                const cekRes = await fetch(cekRiwayatUrl);
                
                if (cekRes.ok) {
                    return res.status(200).json({ message: 'Top up sudah pernah diproses' });
                }

                const simpanRiwayatUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/riwayat_topup?key=${apiKey}`;
                await fetch(simpanRiwayatUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fields: {
                            order_id: { stringValue: orderId },
                            email: { stringValue: email },
                            nominal: { doubleValue: nominal },
                            waktu: { timestampValue: new Date().toISOString() }
                        }
                    })
                });

                const getUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/saldo_pelanggan/${emailKey}?key=${apiKey}`;
                const getRes = await fetch(getUrl);
                let currentSaldo = 0;

                if (getRes.ok) {
                    const getData = await getRes.json();
                    if (getData.fields && getData.fields.saldo) {
                        currentSaldo = getData.fields.saldo.integerValue ? parseInt(getData.fields.saldo.integerValue) : parseFloat(getData.fields.saldo.doubleValue);
                    }
                }

                const newSaldo = currentSaldo + nominal;

                const postUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/saldo_pelanggan/${emailKey}?updateMask.fieldPaths=email&updateMask.fieldPaths=saldo&key=${apiKey}`;
                const bodyData = {
                    fields: {
                        email: { stringValue: email },
                        saldo: { doubleValue: newSaldo }
                    }
                };

                await fetch(postUrl, {
                    method: 'PATCH', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyData)
                });

                return res.status(200).json({ message: 'Top Up Saldo Berhasil' });
            }
        }

        res.status(200).json({ message: 'Webhook Berhasil Diterima' });

    } catch (error) {
        res.status(500).json({ message: 'Webhook Error Internal', error: error.message });
    }
}
