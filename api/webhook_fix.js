export default async function handler(req, res) {
    console.log("🚀 WEBHOOK FIX MASUK!");

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const data = req.body;
    const projectId = 'kebab-idi';
    const apiKey = 'AIzaSyCceiYONY_sx9ivD0CDDQGoB9OXm05h4CY';

    try {
        const { order_id, gross_amount, transaction_status } = data;

        // Hanya proses jika ini Top Up dan statusnya settlement (berhasil)
        if (order_id && order_id.startsWith('TOPUP-')) {
            if (transaction_status === 'settlement' || (transaction_status === 'capture' && data.fraud_status === 'accept')) {
                
                const email = data.customer_details.email;
                const emailKey = email.replace(/[^a-zA-Z0-9]/g, '');
                const nominal = parseFloat(gross_amount);

                console.log(`Memproses Top Up: ${order_id} | ${email} | Rp ${nominal}`);

                // 1. Cek Anti-Double
                const cekUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/riwayat_topup/${order_id}?key=${apiKey}`;
                const cekRes = await fetch(cekUrl);
                if (cekRes.ok) {
                    console.log("Sudah pernah diproses.");
                    return res.status(200).json({ message: 'Sudah diproses' });
                }

                // 2. Simpan Riwayat
                await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/riwayat_topup?key=${apiKey}`, {
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

                // 3. Ambil Saldo Sekarang
                const getRes = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/saldo_pelanggan/${emailKey}?key=${apiKey}`);
                let currentSaldo = 0;
                if (getRes.ok) {
                    const getData = await getRes.json();
                    if (getData.fields && getData.fields.saldo) {
                        currentSaldo = getData.fields.saldo.integerValue ? parseInt(getData.fields.saldo.integerValue) : parseFloat(getData.fields.saldo.doubleValue);
                    }
                }

                // 4. Update Saldo
                const newSaldo = currentSaldo + nominal;
                await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/saldo_pelanggan/${emailKey}?updateMask.fieldPaths=email&updateMask.fieldPaths=saldo&key=${apiKey}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fields: {
                            email: { stringValue: email },
                            saldo: { doubleValue: newSaldo }
                        }
                    })
                });

                console.log(`✅ SUKSES! Saldo baru: ${newSaldo}`);
                return res.status(200).json({ message: 'Top Up Berhasil' });
            }
        }
        
        return res.status(200).json({ message: 'Bukan transaksi topup' });

    } catch (error) {
        console.error("❌ ERROR:", error.message);
        return res.status(500).json({ message: 'Internal Error' });
    }
}
