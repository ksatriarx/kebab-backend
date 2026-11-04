export default async function handler(req, res) {
    // Hanya izinkan metode POST
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // Izinkan akses dari web Anda (CORS)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // Ambil data dari frontend (index.html nanti)
        const { order_id, gross_amount, nama_pembeli, email_pembeli } = req.body;

        // Siapkan Base64 untuk Auth Midtrans
        const serverKey = process.env.MIDTRANS_SERVER_KEY;
        const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
        const authString = Buffer.from(serverKey + ':').toString('base64');
        const midtransUrl = isProduction 
            ? 'https://app.midtrans.com/snap/v1/transactions' 
            : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

        // Tembak API Midtrans
        const response = await fetch(midtransUrl, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Basic ${authString}`
            },
            body: JSON.stringify({
                transaction_details: {
                    order_id: order_id,
                    gross_amount: gross_amount
                },
                customer_details: {
                    first_name: nama_pembeli,
                    email: email_pembeli || 'pelanggan@kebabidi.com'
                }
            })
        });

        const data = await response.json();

        if (data.token) {
            // Kirim token kembali ke website
            res.status(200).json({ token: data.token });
        } else {
            res.status(500).json({ message: 'Gagal dapat token', error: data });
        }

    } catch (error) {
        res.status(500).json({ message: 'Terjadi kesalahan server', error: error.message });
    }
}
