import crypto from 'crypto';

export default async function handler(req, res) {
    console.log("🚀 WEBHOOK MASUK (MODE AMAN)");

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const data = req.body;
    // Bersihkan spasi/enter gaib dari Server Key
    const serverKey = process.env.MIDTRANS_SERVER_KEY ? process.env.MIDTRANS_SERVER_KEY.trim() : '';
    const projectId = 'kebab-idi';
    const apiKey = 'AIzaSyCceiYONY_sx9ivD0CDDQGoB9OXm05h4CY';

    try {
        const { order_id, status_code, gross_amount, signature_key, transaction_status } = data;

        // 1. VALIDASI SIGNATURE (MENGGUNAKAN STRING ASLI DARI MIDTRANS)
        const signatureInput = `${order_id}${status_code}${gross_amount}${serverKey}`;
        const hash = crypto.createHash('sha512').update(signatureInput).digest('hex');

        console.log("Hash Kita:", hash);
        console.log("Hash Midtrans:", signature_key);

        if (hash !== signature_key) {
            console.error("❌ SIGNATURE TIDAK COCOK");
            return res.status(401).json({ message: 'Signature tidak valid' });
        }

        console.log("✅ SIGNATURE VALID");

        // 2. PROSES TOPUP
        if (order_id.startsWith('TOPUP-')) {
            if (transaction_status === 'settlement' || (transaction_status === 'capture' && data.fraud_status === 'accept')) {
                const email = data.customer_details.email;
                const emailKey = email.replace(/[^a-zA-Z0-9]/g, '');
                const nominal = parseFloat(gross_amount);

                // Cek Anti-Double Input
                const cekRiwayatUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/riwayat_topup/${order_id}?key=${apiKey}`;
                const cekRes = await fetch(cekRiwayatUrl);

                if (cekRes.ok) {
                    console.log("ℹ️ Transaksi sudah pernah diproses");
                    return res.status(200).json({ message: 'Sudah diproses' });
                }

                // Simpan Riwayat
                const simpanRiwayatUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/riwayat_topup?key=${apiKey}`;
                await fetch(simpanRiwayatUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fields: {
                            order_id: { stringValue: order_id },
                            email: { stringValue: email },
                            nominal: { doubleValue: nominal },
                            waktu: { timestampValue: new Date().toISOString() }
                        }
                    })
                });

                // Ambil Saldo Saat Ini
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

                // Update Saldo (Gunakan PATCH agar data fcm_token tidak terhapus)
                const postUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/saldo_pelanggan/${emailKey}?updateMask.fieldPaths=email&updateMask.fieldPaths=saldo&key=${apiKey}`;
                await fetch(postUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fields: {
                            email: { stringValue: email },
                            saldo: { doubleValue: newSaldo }
                        }
                    })
                });

                console.log(`✅ TOPUP BERHASIL. Saldo baru: ${newSaldo}`);
                return res.status(200).json({ message: 'Top Up Berhasil' });
            }
        }

        return res.status(200).json({ message: 'Bukan transaksi topup settlement' });

    } catch (error) {
        console.error("❌ WEBHOOK ERROR:", error.message);
        return res.status(500).json({ message: 'Internal Error' });
    }
}
