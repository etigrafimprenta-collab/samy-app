'use client';
import { useAuth } from '@/lib/useAuth';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import ListadoVotantesMesa from './ListadoVotantesMesa';

export default function MesarioDashboard() {
  const { user } = useAuth();
  const [mesarioData, setMesarioData] = useState(null);
  const [votantes, setVotantes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, votaron: 0, pendientes: 0, nuestros: 0 });

  useEffect(() => {
    if (!user) return;

    const cargarDatos = async () => {
      try {
        // Obtener datos del mesario
        const mesarioDoc = await db.collection('users').doc(user.uid).get();
        const datos = mesarioDoc.data();
        setMesarioData(datos);

        // Obtener votantes de su mesa
        const q = query(
          collection(db, 'voters'),
          where('local', '==', datos.local),
          where('mesa', '==', datos.mesa.toString())
        );
        const snapshot = await getDocs(q);
        const votos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setVotantes(votos);

        // Calcular estadísticas
        const votaron = votos.filter((v) => v.estado === 'ya_voto').length;
        const pendientes = votos.length - votaron;
        const nuestros = votos.filter((v) => v.nuestro_votante === true).length;

        setStats({ total: votos.length, votaron, pendientes, nuestros });
      } catch (error) {
        console.error('Error cargando datos:', error);
      } finally {
        setLoading(false);
      }
    };

    cargarDatos();
  }, [user]);

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Cargando...</div>;
  }

  if (!mesarioData) {
    return <div style={{ padding: '20px', color: 'red' }}>Error: No se encontraron datos del mesario</div>;
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '20px' }}>
        Mesa {mesarioData.mesa} - {mesarioData.local}
      </h1>

      {/* Estadísticas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '30px' }}>
        <div style={{ background: '#e0f2fe', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
          <p style={{ color: '#666', fontSize: '14px' }}>Total Votantes</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#0369a1' }}>{stats.total}</p>
        </div>
        <div style={{ background: '#dcfce7', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
          <p style={{ color: '#666', fontSize: '14px' }}>Ya Votaron</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#16a34a' }}>{stats.votaron}</p>
        </div>
        <div style={{ background: '#fef3c7', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
          <p style={{ color: '#666', fontSize: '14px' }}>Pendientes</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#d97706' }}>{stats.pendientes}</p>
        </div>
        <div style={{ background: '#f3e8ff', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
          <p style={{ color: '#666', fontSize: '14px' }}>Nuestros Votantes</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#9333ea' }}>{stats.nuestros}</p>
        </div>
      </div>

      {/* Listado de votantes */}
      <ListadoVotantesMesa votantes={votantes} mesaData={mesarioData} />
    </div>
  );
}