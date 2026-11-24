import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import worker from '../../../../worker.js';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get('authorization');
  const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!supabaseUrl || !supabaseAnonKey || !accessToken) {
    return NextResponse.json({ ok: false, message: 'Sesi login tidak valid.' }, { status: 401 });
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) {
    return NextResponse.json({ ok: false, message: 'Sesi login telah berakhir.' }, { status: 401 });
  }

  try {
    const summary = await worker.runDueTasksOnce();
    return NextResponse.json({
      ok: summary.failed === 0,
      message: summary.total
        ? `Worker selesai. Berhasil: ${summary.succeeded}, gagal: ${summary.failed}. Periksa log di tabel antrean.`
        : 'Tidak ada tugas yang sudah jatuh tempo.',
    });
  } catch (error) {
    console.error('Gagal menjalankan worker:', error);
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Worker gagal dijalankan.',
      },
      { status: 500 }
    );
  }
}
