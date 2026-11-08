// ==========================================
// VERIFIKASI SIGNATURE (WAJIB untuk Production)
// ==========================================
const serverKey = (process.env.MIDTRANS_SERVER_KEY || '').trim();
if (!serverKey) {
    console.error('❌ MIDTRANS_SERVER_KEY belum diset di Vercel!');
    return res.status(500).json({ message: 'Server key not configured' });
}

const raw = order_id + status_code + gross_amount + serverKey;
const expectedSignature = crypto.createHash('sha512').update(raw).digest('hex');

// TAMBAHAN UNTUK DEBUG:
console.log("=== DEBUG TEST NOTIFICATION ===");
console.log("Data diterima dari Midtrans:", JSON.stringify(data));
console.log("Raw yang dihitung Vercel:", raw);
console.log("Signature dari Midtrans:", signature_key);
console.log("Signature dari Vercel:", expectedSignature);
console.log("===============================");

if (signature_key !== expectedSignature) {
    console.error(`❌ Signature TIDAK VALID untuk order ${order_id}. Request ditolak.`);
    return res.status(403).json({ message: 'Invalid signature' });
}
