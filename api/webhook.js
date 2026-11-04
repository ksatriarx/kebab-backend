import crypto from 'crypto';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const data = req.body;
    const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
    
    const projectId = 'kebab-idi';
    const apiKey = 'AIzaSyCceiYONY_sx9ivD0CDDQGoB9OXm05h4CY';

    try {
        // Hitung Signature
        const grossAmountStr = parseFloat(data.gross_amount).toFixed(2);
        const signatureInput = `${data.order_id}${data.status_code}${grossAmountStr}${serverKey}`;
        const hash = crypto.createHash('sha512').update(signatureInput).digest('hex');

        // ==========================================
        // SIMPAN HASIL DETEKTIF KE FIREBASE (Agar mudah dibaca)
        // ==========================================
        const debugUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/debug_logs?key=${apiKey}`;
        const debugData = {
            fields: {
                order_id: { stringValue: String(data.order_id || 'Kosong') },
                hash_dari_vercel: { stringValue: hash },
                hash_dari_midtrans: { stringValue: String(data.signature_key || 'Kosong') },
                panjang_server_key: { stringValue: String(serverKey.length) }, // Cek panjangnya
                server_key_10_huruf_pertama: { stringValue: serverKey.substring(0, 10) + "..." }
            }
        };
        
        await fetch(debugUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(debugData)
        });
        // ==========================================

        if (hash !== data.signature_key) {
            return res.status(401).json({ message: 'Signature tidak valid' });
        }

        // --- LOGIKA SIMPAN SALDO (Sama seperti sebelumnya) ---
        if (data.order_id.startsWith('TOPUP-')) {
            if (data.transaction_status === 'settlement' || data.transaction_status === 'capture') {
                const email = data.customer_details.email;
                const emailKey = email.replace(/[^a-zA-Z0-9]/g, ""); 
                const nominal = parseFloat(data.gross_amount);

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
                const postUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/saldo_pelanggan/${emailKey}?key=${apiKey}`;
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
        } else {
            const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/transaksi_online?key=${apiKey}`;
            const firestoreData = {
                fields: {
                    order_id: { stringValue: data.order_id },
                    status_pembayaran: { stringValue: data.transaction_status },
                    total_bayar: { doubleValue: parseFloat(data.gross_amount) },
                    metode: { stringValue: data.payment_type },
                    waktu: { timestampValue: new Date().toISOString() }
                }
            };
            await fetch(firestoreUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(firestoreData)
            });
        }

        res.status(200).json({ message: 'Webhook Berhasil Diterima' });

    } catch (error) {
        res.status(500).json({ message: 'Webhook Error Internal', error: error.message });
    }
}
