import crypto from 'crypto';

export default async function handler(req, res) {
    // 1. Midtrans selalu mengirim data via POST
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const data = req.body;
    const serverKey = process.env.MIDTRANS_SERVER_KEY ? process.env.MIDTRANS_SERVER_KEY.trim() : '';
    
    // Data Firebase Anda (sama seperti di index.html)
    const projectId = 'kebab-idi';
    const apiKey = 'AIzaSyCceiYONY_sx9ivD0CDDQGoB9OXm05h4CY';

    try {
        // 2. VERIFIKASI KEAMANAN (Mencegah orang iseng nembak API kita)
        // Midtrans mengirim 'signature_key', kita cocokkan dengan rumus rahasia
        const signatureInput = `${data.order_id}${data.status_code}${data.gross_amount}${serverKey}`;
        const hash = crypto.createHash('sha512').update(signatureInput).digest('hex');

        if (hash !== data.signature_key) {
            return res.status(401).json({ message: 'Signature tidak valid (Palsu)' });
        }

        // 3. SIMPAN KE DATABASE FIREBASE (via REST API)
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
            const errData = await response.json();
            throw new Error(JSON.stringify(errData));
        }

        // 4. Beri tahu Midtrans bahwa data sudah diterima
        res.status(200).json({ message: 'Webhook Berhasil Diterima' });

    } catch (error) {
        res.status(500).json({ message: 'Webhook Error', error: error.message });
    }
}
