import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

export default async function handler(req, res) {
    // 1. IZINKAN AKSES (CORS)
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

        // Pastikan Server Key terbaca dan bersih dari spasi
        const serverKey = (process.env.MIDTRANS_SERVER_KEY || '').trim();
        
        if (!serverKey) {
            console.error('❌ ERROR: MIDTRANS_SERVER_KEY tidak ditemukan di Vercel!');
            return res.status(500).json({ message: 'Server Key Midtrans belum diset di Vercel' });
        }

        // Cek mode Production atau Sandbox
        const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
        
        console.log(`[START] Meminta Token Midtrans (Mode: ${isProduction ? 'PRODUCTION (UANG ASLI)' : 'SANDBOX'})...`);
        console.log(`[INFO] Order ID: ${order_id}, Nominal: ${gross_amount}`);

        const authString = Buffer.from(serverKey + ':').toString('base64');
        
        const midtransUrl = isProduction 
            ? 'https://app.midtrans.com/snap/v1/transactions' 
            : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

        // Batas waktu 10 detik
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

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
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const data = await response.json();

        if (data.token) {
            console.log(`✅ [SUCCESS] Token berhasil didapatkan!`);
            res.status(200).json({ token: data.token });
        } else {
            // JIKA GAGAL, TAMPILKAN PESAN ASLI DARI MIDTRANS DI LOG VERCEL
            console.error("❌ GAGAL DAPAT TOKEN. Pesan dari Midtrans:", JSON.stringify(data));
            res.status(500).json({ message: 'Gagal dapat token', error: data });
        }

    } catch (error) {
        console.error("❌ SERVER ERROR:", error.message);
        if (error.name === 'AbortError') {
            return res.status(504).json({ message: 'Koneksi ke Midtrans Timeout' });
        }
        res.status(500).json({ message: 'Kesalahan server', detail: error.message });
    }
}
