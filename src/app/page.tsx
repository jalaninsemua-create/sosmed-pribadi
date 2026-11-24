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
      alert('Format Cookies harus berupa JSON valid dari ekstensi Cookie-Editor!');
      return;
    }

    const { error } = await supabase.from('accounts').insert({
      name: accName,
      cookies: accCookies,
      proxy: accProxy.trim() || null,
      status: 'active',
    });

    if (error) alert(error.message);
    else {
      setAccName('');
      setAccCookies('');
      setAccProxy('');
      fetchData();
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedAccounts.length === 0) return alert('Pilih minimal 1 akun FB!');

    setSubmitting(true);
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .insert({ target_url: targetUrl, action_type: actionType, min_delay: minDelay, max_delay: maxDelay })
      .select()
      .single();

    if (campErr || !campaign) {
      alert('Gagal membuat kampanye: ' + campErr?.message);
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
    if (taskErr) alert('Gagal membuat antrean: ' + taskErr.message);
    else {
      setTargetUrl('');
      setCommentsRaw('');
      setSelectedAccounts([]);
      fetchData();
      alert(`${taskRows.length} antrean berhasil dijadwalkan!`);
    }
    setSubmitting(false);
  };

  const toggleAccount = (id: string) => {
    setSelectedAccounts((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleRunWorker = async () => {
    setRunningWorker(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/run-worker', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = (await response.json()) as { ok: boolean; message: string };
      alert(result.message);
      await fetchData();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal menjalankan worker.');
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
    </div>
  );
}