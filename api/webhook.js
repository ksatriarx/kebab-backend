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
        // 1. KUNCI KEAMANAN (DENGAN PERBAIKAN DESIMAL)
        const grossAmountStr = parseFloat(data.gross_amount).toFixed(2);
        const signatureInput = `${data.order_id}${data.status_code}${grossAmountStr}${serverKey}`;
        const hash = crypto.createHash('sha512').update(signatureInput).digest('hex');

        if (hash !== data.signature_key) {
            return res.status(401).json({ message: 'Signature tidak valid' });
        }

        // 2. PROSES TOP UP SALDO
        if (data.order_id.startsWith('TOPUP-')) {
            if (data.transaction_status === 'settlement' || data.transaction_status === 'capture') {
                const email = data.customer_details.email;
                const emailKey = email.replace(/[^a-zA-Z0-9]/g, ""); 
                const orderId = data.order_id;
                const nominal = parseFloat(data.gross_amount);

                // --- SISTEM ANTI-DOUBLE (CEK RIWAYAT TOP UP) ---
                // Kita cek apakah Order ID ini sudah pernah diproses sebelumnya
                const cekRiwayatUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/riwayat_topup/${orderId}?key=${apiKey}`;
                const cekRes = await fetch(cekRiwayatUrl);
                
                if (cekRes.ok) {
                    // Jika data ditemukan, berarti sudah pernah diproses. Abaikan!
                    return res.status(200).json({ message: 'Top up sudah pernah diproses (Diabaikan)' });
                }

                // Jika belum pernah diproses, simpan ke riwayat agar tidak diproses 2x
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
                // ------------------------------------------------

                // Ambil saldo saat ini
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

                // Simpan saldo baru
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
            // --- PROSES PESANAN BIASA ---
            // (Opsional: Bisa ditambahkan anti-double juga di sini jika perlu)
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

            const response = await fetch(firestoreUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(firestoreData)
            });

            if (!response.ok) {
                const result = await response.json();
                return res.status(500).json({ message: 'Gagal simpan ke Firebase', error: result.error });
            }
        }

        res.status(200).json({ message: 'Webhook Berhasil Diterima' });

    } catch (error) {
        res.status(500).json({ message: 'Webhook Error Internal', error: error.message });
    }
}
