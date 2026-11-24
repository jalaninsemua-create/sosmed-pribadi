const { createClient } = require('@supabase/supabase-js');
const worker = require('../../worker.js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = event.headers.authorization || event.headers.Authorization;
  const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!supabaseUrl || !supabaseAnonKey || !accessToken) {
    console.warn('Worker ditolak: konfigurasi atau sesi login tidak valid.');
    return { statusCode: 401, body: 'Sesi login tidak valid.' };
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) {
    console.warn('Worker ditolak: sesi login telah berakhir.');
    return { statusCode: 401, body: 'Sesi login telah berakhir.' };
  }

  try {
    const summary = await worker.runDueTasksOnce();
    console.log(`Background worker selesai. Berhasil: ${summary.succeeded}, gagal: ${summary.failed}.`);
    return { statusCode: 200, body: 'Background worker selesai.' };
  } catch (error) {
    console.error('Background worker gagal:', error);
    return { statusCode: 500, body: 'Background worker gagal.' };
  }
};
