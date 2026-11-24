'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

interface Account {
  id: string;
  name: string;
  proxy: string | null;
  status: string;
}

interface Task {
  id: string;
  comment_text: string | null;
  status: string;
  scheduled_at: string;
  log_message: string | null;
  accounts: { name: string } | null;
  campaigns: { target_url: string; action_type: string } | null;
}

interface Notice {
  title: string;
  message: string;
  type: 'success' | 'error';
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export default function Dashboard() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  // Form Akun
  const [accName, setAccName] = useState('');
  const [accCookies, setAccCookies] = useState('');
  const [accProxy, setAccProxy] = useState('');

  // Form Tugas
  const [targetUrl, setTargetUrl] = useState('');
  const [actionType, setActionType] = useState<'like' | 'comment' | 'both'>('both');
  const [commentsRaw, setCommentsRaw] = useState('');
  const [minDelay, setMinDelay] = useState(60);
  const [maxDelay, setMaxDelay] = useState(180);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [runningWorker, setRunningWorker] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const fetchData = async () => {
    const { data: accData } = await supabase.from('accounts').select('id, name, proxy, status').order('created_at', { ascending: false });
    if (accData) setAccounts(accData);

    const { data: taskData } = await supabase
      .from('tasks')
      .select('id, comment_text, status, scheduled_at, log_message, accounts(name), campaigns(target_url, action_type)')
      .order('scheduled_at', { ascending: false })
      .limit(30);
    if (taskData) setTasks(taskData as unknown as Task[]);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push('/login');
      else fetchData();
    });
  }, [router]);

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      JSON.parse(accCookies); // Validasi format JSON dari Cookie-Editor
    } catch {
      setNotice({
        title: 'Format tidak valid',
        message: 'Format Cookies harus berupa JSON valid dari ekstensi Cookie-Editor!',
        type: 'error',
      });
      return;
    }

    const { error } = await supabase.from('accounts').insert({
      name: accName,
      cookies: accCookies,
      proxy: accProxy.trim() || null,
      status: 'active',
    });

    if (error) setNotice({ title: 'Gagal menyimpan akun', message: error.message, type: 'error' });
    else {
      setAccName('');
      setAccCookies('');
      setAccProxy('');
      fetchData();
      setNotice({ title: 'Berhasil', message: 'Akun berhasil disimpan.', type: 'success' });
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedAccounts.length === 0) {
      setNotice({ title: 'Akun belum dipilih', message: 'Pilih minimal 1 akun FB!', type: 'error' });
      return;
    }

    setSubmitting(true);
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .insert({ target_url: targetUrl, action_type: actionType, min_delay: minDelay, max_delay: maxDelay })
      .select()
      .single();

    if (campErr || !campaign) {
      setNotice({
        title: 'Gagal membuat kampanye',
        message: campErr?.message || 'Kampanye tidak dapat dibuat.',
        type: 'error',
      });
      setSubmitting(false);
      return;
    }

    const commentLines = commentsRaw.split('\n').map((c) => c.trim()).filter(Boolean);
    let currentSchedule = Date.now();

    const taskRows = selectedAccounts.map((accId, index) => {
      if (index > 0) {
        const randomSec = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        currentSchedule += randomSec * 1000;
      }
      const pickedComment =
        commentLines.length > 0 ? commentLines[Math.floor(Math.random() * commentLines.length)] : null;

      return {
        campaign_id: campaign.id,
        account_id: accId,
        comment_text: actionType === 'like' ? null : pickedComment,
        status: 'pending',
        scheduled_at: new Date(currentSchedule).toISOString(),
      };
    });

    const { error: taskErr } = await supabase.from('tasks').insert(taskRows);
    if (taskErr) {
      setNotice({ title: 'Gagal membuat antrean', message: taskErr.message, type: 'error' });
    } else {
      setTargetUrl('');
      setCommentsRaw('');
      setSelectedAccounts([]);
      fetchData();
      setNotice({
        title: 'Antrean dijadwalkan',
        message: `${taskRows.length} antrean berhasil dijadwalkan!`,
        type: 'success',
      });
    }
    setSubmitting(false);
  };

  const toggleAccount = (id: string) => {
    setSelectedAccounts((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleRunWorker = async () => {
    setRunningWorker(true);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        router.push('/login');
        return;
      }

      const { data: dueTasks, error: dueTasksError } = await supabase
        .from('tasks')
        .select('id')
        .eq('status', 'pending')
        .lte('scheduled_at', new Date().toISOString());
      if (dueTasksError) throw dueTasksError;

      const taskIds = dueTasks.map((task) => task.id);
      if (taskIds.length === 0) {
        setNotice({
          title: 'Tidak ada tugas',
          message: 'Tidak ada tugas yang sudah jatuh tempo untuk dijalankan.',
          type: 'success',
        });
        return;
      }

      const isDevelopment = process.env.NODE_ENV === 'development';
      const response = await fetch(isDevelopment ? '/api/run-worker' : '/.netlify/functions/run-worker-background', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new Error(
          `Worker tidak dapat dimulai (HTTP ${response.status}). Periksa status deploy dan log function Netlify.`
        );
      }

      if (isDevelopment) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error(`Server mengembalikan respons tidak valid (HTTP ${response.status}).`);
        }
        const result = (await response.json()) as { ok: boolean; message: string };
        setNotice({
          title: result.ok ? 'Tugas selesai' : 'Tugas selesai dengan kendala',
          message: result.message,
          type: result.ok ? 'success' : 'error',
        });
      } else {
        const startedAt = Date.now();
        let workerStarted = false;
        const startTimeout = 60 * 1000;
        const completionTimeout = 14 * 60 * 1000;

        while (Date.now() - startedAt < completionTimeout) {
          await delay(2000);
          const { data: currentTasks, error: statusError } = await supabase
            .from('tasks')
            .select('id, status')
            .in('id', taskIds);
          if (statusError) throw statusError;

          if (currentTasks.some((task) => task.status === 'processing')) workerStarted = true;
          if (
            currentTasks.length === taskIds.length &&
            currentTasks.every((task) => task.status === 'success' || task.status === 'failed')
          ) {
            const succeeded = currentTasks.filter((task) => task.status === 'success').length;
            const failed = currentTasks.length - succeeded;
            setNotice({
              title: failed === 0 ? 'Tugas selesai' : 'Tugas selesai dengan kendala',
              message: `Worker selesai. Berhasil: ${succeeded}, gagal: ${failed}. Periksa log di tabel antrean.`,
              type: failed === 0 ? 'success' : 'error',
            });
            break;
          }

          if (!workerStarted && Date.now() - startedAt >= startTimeout) {
            throw new Error('Worker belum mulai memproses antrean. Periksa deployment dan log function Netlify.');
          }
        }

        if (Date.now() - startedAt >= completionTimeout) {
          throw new Error('Worker belum selesai setelah 14 menit. Periksa status antrean dan log function Netlify.');
        }
      }
      await fetchData();
    } catch (error) {
      setNotice({
        title: 'Gagal menjalankan worker',
        message: error instanceof Error ? error.message : 'Gagal menjalankan worker.',
        type: 'error',
      });
    } finally {
      setRunningWorker(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6 text-gray-800">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow">
          <h1 className="text-xl font-bold">FB Engagement Controller</h1>
          <div className="space-x-2">
            <button
              type="button"
              onClick={handleRunWorker}
              disabled={runningWorker}
              className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50"
            >
              {runningWorker ? 'Menjalankan...' : 'Jalankan Tugas'}
            </button>
            <button onClick={fetchData} className="px-3 py-1.5 bg-gray-200 rounded text-sm hover:bg-gray-300">
              Refresh Data
            </button>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                router.push('/login');
              }}
              className="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* KOLOM 1: TAMBAH AKUN FB */}
          <div className="bg-white p-5 rounded-lg shadow space-y-4">
            <h2 className="font-bold text-lg border-b pb-2">1. Tambah Akun Facebook</h2>
            <form onSubmit={handleAddAccount} className="space-y-3">
              <input
                type="text"
                placeholder="Nama / Label Akun (misal: Akun Budi)"
                required
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                className="w-full border rounded p-2 text-sm"
              />
              <textarea
                placeholder="Paste JSON Cookies dari ekstensi Cookie-Editor..."
                required
                rows={3}
                value={accCookies}
                onChange={(e) => setAccCookies(e.target.value)}
                className="w-full border rounded p-2 text-xs font-mono"
              />
              <input
                type="text"
                placeholder="Proxy (opsional, format: http://user:pass@ip:port)"
                value={accProxy}
                onChange={(e) => setAccProxy(e.target.value)}
                className="w-full border rounded p-2 text-sm"
              />
              <button type="submit" className="w-full bg-green-600 text-white py-2 rounded text-sm hover:bg-green-700">
                Simpan Akun
              </button>
            </form>

            <div className="pt-2">
              <h3 className="text-sm font-semibold mb-2">Daftar Akun ({accounts.length})</h3>
              <div className="max-h-48 overflow-y-auto divide-y border rounded">
                {accounts.map((acc) => (
                  <div key={acc.id} className="p-2 flex justify-between items-center text-sm">
                    <div>
                      <p className="font-medium">{acc.name}</p>
                      <p className="text-xs text-gray-500">{acc.proxy ? 'Pakai Proxy' : 'Tanpa Proxy'}</p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        acc.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {acc.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* KOLOM 2: BUAT TUGAS TARGET */}
          <div className="bg-white p-5 rounded-lg shadow space-y-4">
            <h2 className="font-bold text-lg border-b pb-2">2. Buat Tugas Like & Komentar</h2>
            <form onSubmit={handleCreateCampaign} className="space-y-3">
              <input
                type="url"
                placeholder="Link Target Postingan Facebook (https://www.facebook.com/...)"
                required
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                className="w-full border rounded p-2 text-sm"
              />
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value as 'like' | 'comment' | 'both')}
                  className="border rounded p-2 text-sm"
                >
                  <option value="both">Like + Komen</option>
                  <option value="like">Like Saja</option>
                  <option value="comment">Komen Saja</option>
                </select>
                <input
                  type="number"
                  min={10}
                  value={minDelay}
                  onChange={(e) => setMinDelay(Number(e.target.value))}
                  placeholder="Min jeda (dtk)"
                  className="border rounded p-2 text-sm"
                />
                <input
                  type="number"
                  min={15}
                  value={maxDelay}
                  onChange={(e) => setMaxDelay(Number(e.target.value))}
                  placeholder="Max jeda (dtk)"
                  className="border rounded p-2 text-sm"
                />
              </div>
              {actionType !== 'like' && (
                <textarea
                  placeholder="Tulis variasi komentar (1 baris = 1 komentar, sistem akan memilih acak per akun)"
                  required
                  rows={3}
                  value={commentsRaw}
                  onChange={(e) => setCommentsRaw(e.target.value)}
                  className="w-full border rounded p-2 text-sm"
                />
              )}

              <div>
                <p className="text-sm font-medium mb-1">Pilih Akun Eksekutor:</p>
                <div className="max-h-32 overflow-y-auto border rounded p-2 space-y-1">
                  {accounts
                    .filter((a) => a.status === 'active')
                    .map((acc) => (
                      <label key={acc.id} className="flex items-center space-x-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedAccounts.includes(acc.id)}
                          onChange={() => toggleAccount(acc.id)}
                        />
                        <span>{acc.name}</span>
                      </label>
                    ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-blue-600 text-white py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Menjadwalkan...' : 'Jadwalkan Antrean'}
              </button>
            </form>
          </div>
        </div>

        {/* TABEL MONITORING ANTREAN */}
        <div className="bg-white p-5 rounded-lg shadow">
          <h2 className="font-bold text-lg mb-3">Status Antrean Terbaru</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-2">Akun</th>
                  <th className="p-2">Aksi</th>
                  <th className="p-2">Komentar</th>
                  <th className="p-2">Jadwal Jalan</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Log</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="p-2 font-medium">{t.accounts?.name}</td>
                    <td className="p-2 uppercase text-xs">{t.campaigns?.action_type}</td>
                    <td className="p-2 truncate max-w-xs">{t.comment_text || '-'}</td>
                    <td className="p-2 text-xs">{new Date(t.scheduled_at).toLocaleTimeString('id-ID')}</td>
                    <td className="p-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          t.status === 'success'
                            ? 'bg-green-100 text-green-700'
                            : t.status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="p-2 text-xs text-gray-500">{t.log_message || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {runningWorker && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/50 p-4"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-4 rounded-xl bg-white px-8 py-6 text-center shadow-xl">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
            <div>
              <p className="font-semibold text-gray-900">Sedang menjalankan tugas</p>
              <p className="mt-1 text-sm text-gray-500">Mohon tunggu, proses sedang berlangsung.</p>
            </div>
          </div>
        </div>
      )}
      {notice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="notice-title"
            aria-describedby="notice-message"
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
          >
            <h2
              id="notice-title"
              className={`text-lg font-semibold ${notice.type === 'success' ? 'text-green-700' : 'text-red-700'}`}
            >
              {notice.title}
            </h2>
            <p id="notice-message" className="mt-2 whitespace-pre-wrap text-sm text-gray-600">
              {notice.message}
            </p>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}