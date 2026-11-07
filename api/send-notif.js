import admin from 'firebase-admin';

// Inisialisasi Firebase Admin
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (error) {
        console.error("Gagal inisialisasi Firebase Admin:", error.message);
    }
}

export default async function handler(req, res) {
    // Izinkan CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    const { token, title, body } = req.body;

    if (!token) {
        return res.status(400).json({ message: 'Token FCM tidak ditemukan' });
    }

    try {
        const message = {
            notification: { title: title, body: body },
            token: token
        };

        // Kirim pesan via Firebase Admin SDK
        const response = await admin.messaging().send(message);
        console.log('✅ Notifikasi terkirim:', response);
        res.status(200).json({ success: true, response });
    } catch (error) {
        console.error('❌ Gagal kirim notifikasi:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
}
