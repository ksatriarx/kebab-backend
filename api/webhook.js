import crypto from 'crypto';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const data = req.body;
    // Bersihkan server key dari semua jenis spasi, enter, atau karakter aneh
    const serverKey = process.env.MIDTRANS_SERVER_KEY ? process.env.MIDTRANS_SERVER_KEY.replace(/\s+/g, '') : '';
    
    const projectId = 'kebab-idi';
    const apiKey = 'AIzaSyCceiYONY_sx9ivD0CDDQGoB9OXm05h4CY';

    try {
        // 1. VALIDASI SIGNATURE MIDTRANS
        // Pastikan semua diubah ke string dan gross_amount diformat 2 desimal
        const orderIdStr = String(data.order_id);
        const statusCodeStr = String(data.status_code);
        const grossAmountStr = parseFloat(data.gross_amount).toFixed(2);
        
        const signatureInput = `${orderIdStr}${statusCodeStr}${grossAmountStr}${serverKey}`;
        const hash = crypto.createHash('sha512').update(signatureInput).digest('hex');

        // LOG UNTUK DEBUG JIKA MASIH GAGAL
        console.log("=== DEBUG SIGNATURE ===");
        console.log("Input String:", signatureInput);
        console.log("Hash Kita   :", hash);
        console.log("Hash Midtrans:", data.signature_key);

        if (hash !== data.signature_key) {
            console.error("❌ SIGNATURE TIDAK COCOK!");
            return res.status(401).json({ message: 'Signature tidak valid' });
        }

        console.log("✅ Signature Valid. Memproses data...");

        // 2. PROSES TOP UP SALDO
        if (data.order_id.startsWith('TOPUP-')) {
            if (data.transaction_status === 'settlement' || data.transaction_status === 'capture') {
                const email = data.customer_details.email;
                const emailKey = email.replace(/[^a-zA-Z0-9]/g, ""); 
                const orderId = data.order_id;
                const nominal = parseFloat(data.gross_amount);

                // --- SISTEM ANTI-DOUBLE (CEK RIWAYAT TOP UP) ---
                const cekRiwayatUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/riwayat_topup/${orderId}?key=${apiKey}`;
                const cekRes = await fetch(cekRiwayatUrl);
                
                if (cekRes.ok) {
                    console.log("⚠️ Top up sudah pernah diproses sebelumnya. Diabaikan.");
                    return res.status(200).json({ message: 'Top up sudah pernah diproses' });
                }

                // Simpan riwayat agar tidak diproses 2x
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

                // Simpan saldo baru (Gunakan updateMask agar data fcm_token tidak terhapus)
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

                console.log(`✅ Saldo ${email} berhasil ditambah Rp ${nominal}`);
                return res.status(200).json({ message: 'Top Up Saldo Berhasil' });
            }
        } else {
            // --- PROSES PESANAN BIASA (Opsional) ---
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
        console.error("❌ Webhook Error Internal:", error.message);
        res.status(500).json({ message: 'Webhook Error Internal', error: error.message });
    }
}
