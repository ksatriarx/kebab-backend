export default async function handler(req, res) {
    // 1. IZINKAN AKSES (CORS) DI PALING ATAS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 2. JAWAB SINYAL PREFLIGHT DARI BROWSER
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 3. HANYA IZINKAN METODE POST
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { order_id, gross_amount, nama_pembeli, email_pembeli } = req.body;

        const serverKey = process.env.MIDTRANS_SERVER_KEY;
        if (!serverKey) {
            return res.status(500).json({ message: 'Server Key Midtrans belum diset di Vercel' });
        }

        const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
        const authString = Buffer.from(serverKey + ':').toString('base64');
        const midtransUrl = isProduction 
            ? 'https://app.midtrans.com/snap/v1/transactions' 
            : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

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
            res.status(200).json({ token: data.token });
        } else {
            res.status(500).json({ message: 'Gagal dapat token', error: data });
        }

    } catch (error) {
        res.status(500).json({ message: 'Terjadi kesalahan server', error: error.message });
    }
}
