import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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

  const output: string[] = [];

  const exitCode = await new Promise<number | NextResponse>((resolve) => {
    const child = spawn(process.execPath, ['worker.js', '--once'], {
      cwd: process.cwd(),
      env: process.env,
    });

    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(code);
    };

    child.stdout.on('data', (chunk) => output.push(chunk.toString()));
    child.stderr.on('data', (chunk) => output.push(chunk.toString()));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(NextResponse.json({ ok: false, message: error.message }, { status: 500 }));
    });
    child.on('close', (code) => finish(code ?? 1));

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      resolve(
        NextResponse.json(
          { ok: false, message: 'Eksekusi worker melewati batas waktu.' },
          { status: 504 }
        )
      );
    }, 5 * 60 * 1000);
  });

  if (exitCode instanceof NextResponse) return exitCode;

  const message = output.join('').trim();
  if (exitCode !== 0) {
    return NextResponse.json(
      { ok: false, message: message || 'Worker gagal dijalankan.' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: message || 'Worker selesai dijalankan.',
  });
}
