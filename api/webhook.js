import crypto from 'crypto';

export default async function handler(req, res) {
    // Hanya menerima POST dari Midtrans
    if (req.method !== 'POST') {
        return res.status(405).json({
            message: 'Method Not Allowed'
        });
    }

    try {
        // =====================================
        // 1. MEMBACA DATA NOTIFIKASI
        // =====================================

        let data = req.body;

        if (typeof data === 'string') {
            data = JSON.parse(data);
        }

        if (!data || typeof data !== 'object') {
            return res.status(400).json({
                message: 'Invalid notification body'
            });
        }

        const requiredFields = [
            'order_id',
            'status_code',
            'gross_amount',
            'signature_key',
            'transaction_status'
        ];

        for (const field of requiredFields) {
            if (data[field] === undefined || data[field] === null) {
                return res.status(400).json({
                    message: `Missing field: ${field}`
                });
            }
        }

        // =====================================
        // 2. MEMBACA SERVER KEY
        // =====================================

        const serverKey = process.env.MIDTRANS_SERVER_KEY;

        if (!serverKey) {
            console.error('MIDTRANS_SERVER_KEY belum diatur');

            return res.status(500).json({
                message: 'Server configuration error'
            });
        }

        // =====================================
        // 3. VERIFIKASI SIGNATURE MIDTRANS
        // =====================================

        // Gunakan nilai gross_amount asli dari Midtrans.
        const signatureInput =
            String(data.order_id) +
            String(data.status_code) +
            String(data.gross_amount) +
            serverKey.trim();

        const expectedSignature = crypto
            .createHash('sha512')
            .update(signatureInput)
            .digest('hex');

        const receivedSignature = String(data.signature_key);

        const expectedBuffer = Buffer.from(
            expectedSignature,
            'hex'
        );

        const receivedBuffer = Buffer.from(
            receivedSignature,
            'hex'
        );

        const signatureValid =
            /^[a-fA-F0-9]{128}$/.test(receivedSignature) &&
            expectedBuffer.length === receivedBuffer.length &&
            crypto.timingSafeEqual(
                expectedBuffer,
                receivedBuffer
            );

        console.log('=== MIDTRANS WEBHOOK ===');
        console.log('Order ID:', data.order_id);
        console.log('Transaction Status:', data.transaction_status);
        console.log('Status Code:', data.status_code);
        console.log('Gross Amount:', data.gross_amount);
        console.log('Signature Valid:', signatureValid);

        if (!signatureValid) {
            return res.status(401).json({
                message: 'Signature tidak valid'
            });
        }

        // =====================================
        // 4. CEK STATUS PEMBAYARAN
        // =====================================

        const isSettlement =
            data.transaction_status === 'settlement';

        const isCapture =
            data.transaction_status === 'capture' &&
            data.fraud_status === 'accept';

        if (!isSettlement && !isCapture) {
            return res.status(200).json({
                message: 'Notification diterima',
                status: data.transaction_status
            });
        }

        // =====================================
        // 5. KONFIGURASI FIREBASE
        // =====================================

        const projectId = 'kebab-idi';
        const apiKey = process.env.FIREBASE_API_KEY;

        if (!apiKey) {
            console.error('FIREBASE_API_KEY belum diatur');

            return res.status(500).json({
                message: 'Firebase configuration error'
            });
        }

        const amount = Number(data.gross_amount);

        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({
                message: 'Invalid payment amount'
            });
        }

        // =====================================
        // 6. TOP UP SALDO PELANGGAN
        // =====================================

        if (String(data.order_id).startsWith('TOPUP-')) {

            const email = data.customer_details?.email;

            if (!email) {
                return res.status(400).json({
                    message: 'Email pelanggan tidak ditemukan'
                });
            }

            const emailKey = email.replace(/[^a-zA-Z0-9]/g, '');

            const documentUrl =
                `https://firestore.googleapis.com/v1/projects/${projectId}` +
                `/databases/(default)/documents/saldo_pelanggan/${emailKey}` +
                `?key=${apiKey}`;

            // Ambil saldo sekarang
            const getResponse = await fetch(documentUrl);

            let currentSaldo = 0;

            if (getResponse.ok) {
                const document = await getResponse.json();

                const saldoField = document.fields?.saldo;

                if (saldoField?.integerValue !== undefined) {
                    currentSaldo = Number(saldoField.integerValue);
                } else if (saldoField?.doubleValue !== undefined) {
                    currentSaldo = Number(saldoField.doubleValue);
                }

            } else if (getResponse.status !== 404) {
                const errorText = await getResponse.text();

                console.error('Firebase read error:', errorText);

                return res.status(500).json({
                    message: 'Gagal membaca saldo pelanggan'
                });
            }

            const newSaldo = currentSaldo + amount;

            // Simpan saldo baru
            const updateResponse = await fetch(documentUrl, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fields: {
                        email: {
                            stringValue: email
                        },
                        saldo: {
                            doubleValue: newSaldo
                        }
                    }
                })
            });

            if (!updateResponse.ok) {
                const errorText = await updateResponse.text();

                console.error('Firebase update error:', errorText);

                return res.status(500).json({
                    message: 'Gagal memperbarui saldo'
                });
            }

            console.log('Top Up berhasil:', data.order_id);

            return res.status(200).json({
                message: 'Top Up Saldo Berhasil',
                saldo: newSaldo
            });
        }

        // =====================================
        // 7. SIMPAN TRANSAKSI PESANAN
        // =====================================

        const firestoreUrl =
            `https://firestore.googleapis.com/v1/projects/${projectId}` +
            `/databases/(default)/documents/transaksi_online` +
            `?key=${apiKey}`;

        const firestoreData = {
            fields: {
                order_id: {
                    stringValue: String(data.order_id)
                },
                status_pembayaran: {
                    stringValue: String(data.transaction_status)
                },
                total_bayar: {
                    doubleValue: amount
                },
                metode: {
                    stringValue: String(data.payment_type || '')
                },
                waktu: {
                    timestampValue: new Date().toISOString()
                }
            }
        };

        const saveResponse = await fetch(firestoreUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(firestoreData)
        });

        if (!saveResponse.ok) {
            const errorText = await saveResponse.text();

            console.error('Firebase save error:', errorText);

            return res.status(500).json({
                message: 'Gagal menyimpan transaksi'
            });
        }

        console.log('Transaksi berhasil disimpan:', data.order_id);

        return res.status(200).json({
            message: 'Webhook Berhasil Diterima'
        });

    } catch (error) {
        console.error('Webhook error:', error.message);

        return res.status(500).json({
            message: 'Webhook Error Internal'
        });
    }
}
