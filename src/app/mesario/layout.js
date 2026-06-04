'use client';
import { useAuth } from '@/lib/useAuth';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useEffect } from 'react';

export default function MesarioLayout({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/mesario/login');
    }
  }, [user, loading, router]);

  const handleLogout = async () => {
    await signOut(auth);
    router.push('/mesario/login');
  };

  if (loading) return <div>Cargando...</div>;
  if (!user) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <div style={{ width: '200px', background: '#1e3a8a', color: 'white', padding: '20px' }}>
        <h2 style={{ marginBottom: '30px', fontSize: '18px', fontWeight: 'bold' }}>Samy 2026</h2>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <a href="/mesario/dashboard" style={{ color: 'white', textDecoration: 'none' }}>
            📊 Dashboard
          </a>
          <button
            onClick={handleLogout}
            style={{
              background: '#dc2626',
              color: 'white',
              border: 'none',
              padding: '8px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            🚪 Salir
          </button>
        </nav>
        <p style={{ fontSize: '12px', color: '#ccc', marginTop: '40px' }}>
          {user.email}
        </p>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, background: '#f9fafb' }}>
        {children}
      </div>
    </div>
  );
}