import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const manualLikeLog = 'MANUAL_LIKE_REQUIRED: Tombol Like tidak ditemukan; tindakan tidak dapat dikonfirmasi.';

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authorization = request.headers.get('authorization');
  const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!supabaseUrl || !supabaseAnonKey || !accessToken) {
    return NextResponse.json({ message: 'Sesi login tidak valid.' }, { status: 401 });
  }
  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi untuk konfirmasi manual.');
    return NextResponse.json({ message: 'Konfigurasi server belum lengkap.' }, { status: 500 });
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) {
    return NextResponse.json({ message: 'Sesi login telah berakhir.' }, { status: 401 });
  }

  const { taskId } = await context.params;
  const { data: visibleTask, error: visibilityError } = await authClient
    .from('tasks')
    .select('id')
    .eq('id', taskId)
    .eq('status', 'failed')
    .eq('log_message', manualLikeLog)
    .maybeSingle();
  if (visibilityError) {
    console.error('Gagal memverifikasi akses tugas manual:', visibilityError.message);
    return NextResponse.json({ message: 'Gagal memverifikasi akses tugas.' }, { status: 500 });
  }
  if (!visibleTask) {
    return NextResponse.json(
      { message: 'Tugas tidak ditemukan atau tidak memerlukan tindakan manual.' },
      { status: 404 }
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await serviceClient
    .from('tasks')
    .update({
      status: 'success',
      log_message: 'Tindakan diselesaikan manual oleh pengguna.',
    })
    .eq('id', taskId)
    .eq('status', 'failed')
    .eq('log_message', manualLikeLog)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Gagal memperbarui tugas manual:', error.message);
    return NextResponse.json({ message: 'Gagal memperbarui status tugas.' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { message: 'Tugas tidak ditemukan atau tidak memerlukan tindakan manual.' },
      { status: 409 }
    );
  }

  return NextResponse.json({ message: 'Tugas ditandai selesai manual.' });
}
