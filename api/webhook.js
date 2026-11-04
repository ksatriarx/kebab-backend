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
        // 1. PENGECEKAN SIGNATURE DIMATIKAN SEMENTARA
        /*
        const signatureInput = `${data.order_id}${data.status_code}${data.gross_amount}${serverKey}`;
        const hash = crypto.createHash('sha512').update(signatureInput).digest('hex');

        if (hash !== data.signature_key) {
            return res.status(401).json({ message: 'Signature tidak valid' });
        }
        */

        // 2. Cek apakah ini TOP UP SALDO atau PESANAN?
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

                const postRes = await fetch(postUrl, {
                    method: 'PATCH', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyData)
                });

                if (!postRes.ok) {
                    const err = await postRes.json();
                    return res.status(500).json({ message: 'Gagal update saldo', error: err });
                }

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
