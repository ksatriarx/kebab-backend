import crypto from 'node:crypto';

export default async function handler(req, res) {
    // 1. Hanya izinkan metode POST
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const data = req.body;
    const projectId = 'kebab-idi';
    const apiKey = 'AIzaSyCceiYONY_sx9ivD0CDDQGoB9OXm05h4CY';

    try {
        const { order_id, transaction_status, fraud_status, status_code, gross_amount, signature_key } = data;

        // ==========================================
        // BLOK DEBUGGING & VERIFIKASI SIGNATURE
        // ==========================================
        // Pastikan Server Key terbaca dan bersih dari spasi/enter
        const serverKey = (process.env.MIDTRANS_SERVER_KEY || '').trim();
        
        console.log("========== MEMULAI WEBHOOK ==========");
        console.log(`Order ID: ${order_id}`);
        console.log(`Status: ${transaction_status}`);
        
        if (!serverKey) {
            console.error('❌ FATAL: MIDTRANS_SERVER_KEY kosong atau tidak terbaca di Vercel!');
            return res.status(500).json({ message: 'Server key not configured' });
        }

        // Paksa jadi string agar aman saat digabung
        const strOrderId = String(order_id);
        const strStatusCode = String(status_code);
        const strGrossAmount = String(gross_amount);

        // Rumus Midtrans: SHA512(order_id + status_code + gross_amount + ServerKey)
        const raw = strOrderId + strStatusCode + strGrossAmount + serverKey;
        const expectedSignature = crypto.createHash('sha512').update(raw).digest('hex');

        // Log untuk melihat perbandingan
        console.log(`Signature dari Midtrans : ${signature_key}`);
        console.log(`Signature dari Vercel    : ${expectedSignature}`);

        // Jika signature tidak cocok, tolak (403)
        if (signature_key !== expectedSignature) {
            console.error(`❌ TOLAK: Signature tidak cocok untuk order ${order_id}.`);
            return res.status(403).json({ message: 'Invalid signature' });
        }
        
        console.log(`✅ LOLOS: Signature valid!`);
        console.log("=====================================");
        // ==========================================
        // SELESAI BLOK VERIFIKASI
        // ==========================================

        // Cek apakah ini cuma Test Notification dari dashboard Midtrans
        if (strOrderId.includes('test') || strOrderId.includes('TEST')) {
            console.log("ℹ️ Ini adalah Test Notification dari Dashboard Midtrans. Sukses!");
            return res.status(200).json({ message: 'Test Notification Success' });
        }

        // Hanya proses jika pembayaran berhasil (settlement atau capture)
        const isSuccess = transaction_status === 'settlement' || (transaction_status === 'capture' && fraud_status === 'accept');
        
        if (!isSuccess) {
            console.log(`ℹ️ Transaksi ${order_id} belum sukses (${transaction_status}). Diabaikan.`);
            return res.status(200).json({ message: 'Belum settlement' });
        }

        // ==========================================
        // SKENARIO 1: TOP UP SALDO (PREFIX TOPUP-)
        // ==========================================
        if (order_id.startsWith('TOPUP-')) {
            console.log("🚀 Memproses Top Up Saldo...");
            const email = data.customer_details.email;
            const emailKey = email.replace(/[^a-zA-Z0-9]/g, '');
            const nominal = parseFloat(data.gross_amount);

            // Cek Anti-Double Input
            const cekUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/riwayat_topup/${order_id}?key=${apiKey}`;
            const cekRes = await fetch(cekUrl);
            if (cekRes.ok) return res.status(200).json({ message: 'Sudah diproses' });

            // Simpan Riwayat
            await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/riwayat_topup?key=${apiKey}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fields: { order_id: { stringValue: order_id }, email: { stringValue: email }, nominal: { doubleValue: nominal }, waktu: { timestampValue: new Date().toISOString() } } })
            });

            // Ambil Saldo Sekarang
            const getRes = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/saldo_pelanggan/${emailKey}?key=${apiKey}`);
            let currentSaldo = 0;
            if (getRes.ok) { const getData = await getRes.json(); if (getData.fields && getData.fields.saldo) { currentSaldo = getData.fields.saldo.integerValue ? parseInt(getData.fields.saldo.integerValue) : parseFloat(getData.fields.saldo.doubleValue); } }

            // Update Saldo
            const newSaldo = currentSaldo + nominal;
            await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/saldo_pelanggan/${emailKey}?updateMask.fieldPaths=email&updateMask.fieldPaths=saldo&key=${apiKey}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fields: { email: { stringValue: email }, saldo: { doubleValue: newSaldo } } })
            });

            console.log(`✅ Top Up Berhasil. Saldo baru: ${newSaldo}`);
            return res.status(200).json({ message: 'Top Up Berhasil' });
        } 
        
        // ==========================================
        // SKENARIO 2: SELF SERVICE QRIS (PREFIX SELF-)
        // ==========================================
        else if (order_id.startsWith('SELF-')) {
            console.log("🚀 Memproses Pembayaran QRIS Self Service...");
            
            // Cari dokumen pesanan berdasarkan order_id
            const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
            const queryBody = {
                structuredQuery: {
                    from: [{ collectionId: 'transaksi_selfservice' }],
                    where: { fieldFilter: { field: { fieldPath: 'order_id' }, op: 'EQUAL', value: { stringValue: order_id } } },
                    limit: 1
                }
            };

            const qRes = await fetch(queryUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(queryBody) });
            const qData = await qRes.json();

            if (qData[0] && qData[0].document) {
                const docName = qData[0].document.name; 
                // Ubah status menjadi Lunas (QRIS)
                await fetch(`https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=status&key=${apiKey}`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fields: { status: { stringValue: 'Lunas (QRIS)' } } })
                });
                console.log(`✅ Pesanan Self Service ${order_id} LUNAS via QRIS.`);
            } else {
                console.log("❌ Pesanan Self Service tidak ditemukan di database.");
            }
            return res.status(200).json({ message: 'Self Service QRIS Berhasil' });
        }

        return res.status(200).json({ message: 'Order ID tidak dikenali' });

    } catch (error) {
        console.error("❌ WEBHOOK ERROR:", error.message);
        return res.status(500).json({ message: 'Internal Error' });
    }
}
