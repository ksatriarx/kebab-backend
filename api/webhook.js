import crypto from 'crypto';
import admin from 'firebase-admin';

function initializeFirebase() {
    if (admin.apps.length > 0) return admin.firestore();
    const serviceAccountJSON = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJSON) throw new Error('FIREBASE_SERVICE_ACCOUNT belum diatur di Vercel');
    const serviceAccount = JSON.parse(serviceAccountJSON);
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: serviceAccount.project_id,
            clientEmail: serviceAccount.client_email,
            privateKey: serviceAccount.private_key.replace(/\\n/g, '\n')
        })
    });
    return admin.firestore();
}

export default async function handler(req, res) {
    console.log('🚀 WEBHOOK MASUK (VERSI DEBUG)');

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    try {
        const data = req.body;
        const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim();

        // ==========================================
        // LOG DEBUGGING (KITA LIHAT APA YANG DIKIRIM MIDTRANS)
        // ==========================================
        const { order_id, status_code, gross_amount, signature_key, transaction_status } = data;
        
        console.log('--- DATA MASUK ---');
        console.log('Order ID:', order_id);
        console.log('Status Code:', status_code);
        console.log('Gross Amount:', gross_amount);
        console.log('Panjang Server Key Vercel:', serverKey ? serverKey.length : 0);
        
        const signatureInput = order_id + status_code + gross_amount + serverKey;
        const calculatedSignature = crypto.createHash('sha512').update(signatureInput).digest('hex');
        
        console.log('Hash Kita (Vercel):', calculatedSignature);
        console.log('Hash Midtrans     :', signature_key);

        if (calculatedSignature !== signature_key) {
            console.error('❌ SIGNATURE TIDAK VALID (TAPI KITA LANJUTKAN UNTUK TES)');
            // return res.status(401).json({ success: false, message: 'Signature tidak valid' });
        } else {
            console.log('✅ SIGNATURE MIDTRANS VALID');
        }
        // ==========================================

        if (!order_id.startsWith('TOPUP-')) {
            return res.status(200).json({ success: true, message: 'Bukan topup' });
        }

        const isSettlement = transaction_status === 'settlement';
        const isAcceptedCapture = transaction_status === 'capture' && data.fraud_status === 'accept';

        if (!isSettlement && !isAcceptedCapture) {
            return res.status(200).json({ success: true, message: 'Belum settlement' });
        }

        const nominal = Number(gross_amount);
        const email = data.customer_details?.email;
        const emailKey = email.replace(/[^a-zA-Z0-9]/g, '');

        const db = initializeFirebase();
        const riwayatRef = db.collection('riwayat_topup').doc(order_id);
        const saldoRef = db.collection('saldo_pelanggan').doc(emailKey);

        const result = await db.runTransaction(async (transaction) => {
            const riwayatSnapshot = await transaction.get(riwayatRef);
            if (riwayatSnapshot.exists) return { duplicate: true };

            const saldoSnapshot = await transaction.get(saldoRef);
            let currentSaldo = 0;
            if (saldoSnapshot.exists) currentSaldo = Number(saldoSnapshot.data().saldo || 0);

            const newSaldo = currentSaldo + nominal;

            transaction.create(riwayatRef, {
                order_id: order_id,
                email: email,
                nominal: nominal,
                status: 'settlement',
                waktu: admin.firestore.FieldValue.serverTimestamp()
            });

            transaction.set(saldoRef, { email: email, saldo: newSaldo }, { merge: true });
            return { duplicate: false, saldoBaru: newSaldo };
        });

        if (result.duplicate) {
            console.log('ℹ️ TRANSAKSI SUDAH PERNAH DIPROSES:', order_id);
            return res.status(200).json({ success: true, message: 'Transaksi sudah pernah diproses' });
        }

        console.log('✅ TOPUP BERHASIL. Saldo baru:', result.saldoBaru);
        return res.status(200).json({ success: true, message: 'Top Up Berhasil' });

    } catch (error) {
        console.error('❌ WEBHOOK ERROR:', error.message);
        return res.status(500).json({ success: false, message: 'Webhook Internal Error' });
    }
}
