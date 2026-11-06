import crypto from 'crypto';
import admin from 'firebase-admin';

// ==========================================
// FIREBASE ADMIN INITIALIZATION
// ==========================================
function initializeFirebase() {
    if (admin.apps.length > 0) {
        return admin.firestore();
    }

    const serviceAccountJSON = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!serviceAccountJSON) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT belum diatur di Vercel');
    }

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

// ==========================================
// WEBHOOK HANDLER
// ==========================================
export default async function handler(req, res) {
    console.log('🚀 RX KEBAB WEBHOOK DIMULAI');

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    try {
        // 1. VALIDASI KONFIGURASI
        const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim();
        if (!serverKey) {
            throw new Error('MIDTRANS_SERVER_KEY belum diatur');
        }

        const data = req.body;
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ success: false, message: 'Request body tidak valid' });
        }

        const { order_id, status_code, gross_amount, signature_key, transaction_status } = data;

        if (
            typeof order_id !== 'string' ||
            typeof status_code !== 'string' ||
            typeof gross_amount !== 'string' ||
            typeof signature_key !== 'string'
        ) {
            return res.status(400).json({ success: false, message: 'Data transaksi tidak lengkap' });
        }

        // 2. VERIFIKASI SIGNATURE MIDTRANS
        const signatureInput = order_id + status_code + gross_amount + serverKey;
        const calculatedSignature = crypto.createHash('sha512').update(signatureInput).digest('hex');

        const receivedBuffer = Buffer.from(signature_key, 'hex');
        const calculatedBuffer = Buffer.from(calculatedSignature, 'hex');

        const signatureValid = receivedBuffer.length === calculatedBuffer.length && crypto.timingSafeEqual(receivedBuffer, calculatedBuffer);

        if (!signatureValid) {
            console.error('❌ SIGNATURE TIDAK VALID');
            return res.status(401).json({ success: false, message: 'Signature tidak valid' });
        }

        console.log('✅ SIGNATURE MIDTRANS VALID');

        // 3. FILTER TRANSAKSI TOPUP
        if (!order_id.startsWith('TOPUP-')) {
            return res.status(200).json({ success: true, message: 'Notifikasi bukan transaksi topup' });
        }

        // 4. VALIDASI STATUS PEMBAYARAN
        const isSettlement = transaction_status === 'settlement';
        const isAcceptedCapture = transaction_status === 'capture' && data.fraud_status === 'accept';

        if (!isSettlement && !isAcceptedCapture) {
            console.log('ℹ️ Transaksi belum berhasil:', transaction_status);
            return res.status(200).json({ success: true, message: 'Status transaksi belum memerlukan penambahan saldo' });
        }

        // 5. VALIDASI NOMINAL DAN EMAIL
        const nominal = Number(gross_amount);
        const email = data.customer_details?.email;

        if (!Number.isFinite(nominal) || nominal <= 0 || !email || typeof email !== 'string') {
            return res.status(400).json({ success: false, message: 'Nominal atau email pelanggan tidak valid' });
        }

        const emailKey = email.replace(/[^a-zA-Z0-9]/g, '');

        if (!emailKey) {
            return res.status(400).json({ success: false, message: 'Email pelanggan tidak valid' });
        }

        // 6. HUBUNGKAN FIREBASE
        const db = initializeFirebase();
        const riwayatRef = db.collection('riwayat_topup').doc(order_id);
        const saldoRef = db.collection('saldo_pelanggan').doc(emailKey);

        // 7. TRANSAKSI ATOMIK FIRESTORE
        const result = await db.runTransaction(async (transaction) => {
            const riwayatSnapshot = await transaction.get(riwayatRef);

            if (riwayatSnapshot.exists) {
                return { duplicate: true };
            }

            const saldoSnapshot = await transaction.get(saldoRef);
            let currentSaldo = 0;

            if (saldoSnapshot.exists) {
                const saldoData = saldoSnapshot.data();
                currentSaldo = Number(saldoData.saldo || 0);

                if (!Number.isFinite(currentSaldo) || currentSaldo < 0) {
                    throw new Error('Data saldo pelanggan tidak valid');
                }
            }

            const newSaldo = currentSaldo + nominal;

            transaction.create(riwayatRef, {
                order_id: order_id,
                email: email,
                nominal: nominal,
                status: 'settlement',
                waktu: admin.firestore.FieldValue.serverTimestamp()
            });

            transaction.set(saldoRef, {
                email: email,
                saldo: newSaldo
            }, { merge: true });

            return {
                duplicate: false,
                saldoLama: currentSaldo,
                saldoBaru: newSaldo
            };
        });

        // 8. HASIL WEBHOOK
        if (result.duplicate) {
            console.log('ℹ️ TRANSAKSI SUDAH PERNAH DIPROSES:', order_id);
            return res.status(200).json({ success: true, message: 'Transaksi sudah pernah diproses' });
        }

        console.log('✅ TOPUP BERHASIL');
        console.log('Order ID:', order_id);
        console.log('Email:', email);
        console.log('Nominal:', nominal);
        console.log('Saldo baru:', result.saldoBaru);

        return res.status(200).json({
            success: true,
            message: 'Top Up Saldo Berhasil',
            order_id: order_id,
            nominal: nominal
        });

    } catch (error) {
        console.error('❌ WEBHOOK ERROR:', error.message);
        return res.status(500).json({ success: false, message: 'Webhook Internal Error' });
    }
}
