'use client';
import { useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/lib/useAuth';

export default function MarcarVoto({ votante, mesaData, onClose }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleMarcar = async (nuevoEstado) => {
    setLoading(true);
    setError('');

    try {
      const estadoAnterior = votante.estado || 'pendiente';

      // Actualizar votante
      await updateDoc(doc(db, 'voters', votante.id), {
        estado: nuevoEstado,
        ultima_marcacion: serverTimestamp(),
      });

      // Registrar auditoría
      await addDoc(collection(db, 'votationMarks'), {
        voterId: votante.id,
        votante_nombre: votante.nombre,
        votante_cedula: votante.cedula,
        estado_anterior: estadoAnterior,
        estado_nuevo: nuevoEstado,
        mesario_id: user.uid,
        mesario_nombre: mesaData.displayName,
        local: mesaData.local,
        mesa: mesaData.mesa,
        timestamp: serverTimestamp(),
        nuestro_votante: votante.nuestro_votante || false,
      });

      alert(`✅ Votante marcado como: ${nuevoEstado}`);
      onClose();
    } catch (err) {
      setError('Error al marcar votante: ' + err.message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'white',
          padding: '30px',
          borderRadius: '10px',
          maxWidth: '500px',
          width: '90%',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
        }}
      >
        <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '10px' }}>
          Confirmar marcación
        </h2>
        <p style={{ color: '#666', marginBottom: '20px', fontSize: '14px' }}>
          <strong>{votante.nombre}</strong> (Cédula: {votante.cedula})
        </p>

        {error && (
          <div
            style={{
              background: '#fee2e2',
              color: '#991b1b',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '16px',
              fontSize: '14px',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => handleMarcar('ya_voto')}
            disabled={loading}
            style={{
              flex: 1,
              padding: '12px',
              background: '#16a34a',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            ✅ Ya votó
          </button>
          <button
            onClick={() => handleMarcar('pendiente')}
            disabled={loading}
            style={{
              flex: 1,
              padding: '12px',
              background: '#d97706',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            ⏳ Pendiente
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              flex: 1,
              padding: '12px',
              background: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}