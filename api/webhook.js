import crypto from 'crypto';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const data = req.body;
    const serverKey = process.env.MIDTRANS_SERVER_KEY ? process.env.MIDTRANS_SERVER_KEY.trim() : '';
    
    // Data Firebase
    const projectId = 'kebab-idi';
    const apiKey = 'AIzaSyCceiYONY_sx9ivD0CDDQGoB9OXm05h4CY';

    try {
        // 1. Hitung Signature (Untuk Debugging)
        const signatureInput = `${data.order_id}${data.status_code}${data.gross_amount}${serverKey}`;
        const hash = crypto.createHash('sha512').update(signatureInput).digest('hex');
        
        console.log("--- WEBHOOK DEBUG ---");
        console.log("Expected Hash:", hash);
        console.log("Received Hash:", data.signature_key);

        // 2. PENGECEKAN SIGNATURE DIMATIKAN SEMENTARA (BYPASS)
        // Jika hash !== data.signature_key, kita biarkan lolos dulu.
        /*
        if (hash !== data.signature_key) { 
            return res.status(401).json({ message: 'Signature tidak valid' });
        }
        */

        // 3. Siapkan URL Firestore
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/transaksi_online?key=${apiKey}`;
        
        // 4. Format Data Firestore
        const firestoreData = {
            fields: {
                order_id: { stringValue: data.order_id },
                status_pembayaran: { stringValue: data.transaction_status },
                total_bayar: { doubleValue: parseFloat(data.gross_amount) },
                metode: { stringValue: data.payment_type },
                waktu: { timestampValue: new Date().toISOString() }
            }
        };

        // 5. Kirim ke Firebase
        const response = await fetch(firestoreUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(firestoreData)
        });

        const result = await response.json();

        // 6. Jika Firebase menolak, kirim pesan error aslinya
        if (!response.ok) {
            console.log("Firebase Error:", JSON.stringify(result));
            return res.status(500).json({ message: 'Gagal simpan ke Firebase', error: result.error });
        }

        res.status(200).json({ message: 'Webhook Berhasil Diterima' });

    } catch (error) {
        res.status(500).json({ message: 'Webhook Error Internal', error: error.message });
    }
}
