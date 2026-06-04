'use client';
import { useState } from 'react';
import MarcarVoto from './MarcarVoto';

export default function ListadoVotantesMesa({ votantes, mesaData }) {
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('todos'); // todos, nuestros, votaron, pendientes
  const [votanteSeleccionado, setVotanteSeleccionado] = useState(null);

  const votantesFiltrados = votantes.filter((votante) => {
    // Filtro por búsqueda
    const busquedaLower = busqueda.toLowerCase();
    const coincide =
      votante.nombre?.toLowerCase().includes(busquedaLower) ||
      votante.cedula?.includes(busqueda) ||
      votante.orden?.toString().includes(busqueda);

    if (!coincide) return false;

    // Filtro por estado
    if (filtro === 'nuestros') return votante.nuestro_votante === true;
    if (filtro === 'votaron') return votante.estado === 'ya_voto';
    if (filtro === 'pendientes') return votante.estado !== 'ya_voto';

    return true;
  });

  return (
    <div>
      {/* Buscador y filtros */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Buscar por nombre, cédula u orden..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          style={{
            flex: 1,
            minWidth: '200px',
            padding: '10px',
            border: '1px solid #ddd',
            borderRadius: '6px',
            fontSize: '14px',
          }}
        />
        <select
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          style={{
            padding: '10px',
            border: '1px solid #ddd',
            borderRadius: '6px',
            fontSize: '14px',
          }}
        >
          <option value="todos">Todos</option>
          <option value="nuestros">Nuestros Votantes</option>
          <option value="votaron">Ya Votaron</option>
          <option value="pendientes">Pendientes</option>
        </select>
      </div>

      {/* Tabla de votantes */}
      <div style={{ overflowX: 'auto', background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f3f4f6', borderBottom: '2px solid #e5e7eb' }}>
            <tr>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: 'bold' }}>Orden</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: 'bold' }}>Nombre</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: 'bold' }}>Cédula</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: 'bold' }}>Estado</th>
              <th style={{ padding: '12px', textAlign: 'center', fontWeight: 'bold' }}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {votantesFiltrados.map((votante, idx) => (
              <tr
                key={votante.id}
                style={{
                  borderBottom: '1px solid #e5e7eb',
                  background: votante.nuestro_votante ? '#f0fdf4' : 'white',
                  opacity: votante.estado === 'ya_voto' ? 0.7 : 1,
                }}
              >
                <td style={{ padding: '12px' }}>{votante.orden}</td>
                <td style={{ padding: '12px', fontWeight: votante.nuestro_votante ? 'bold' : 'normal' }}>
                  {votante.nombre}
                  {votante.nuestro_votante && (
                    <span style={{ marginLeft: '8px', background: '#86efac', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>
                      🟢 Nuestro
                    </span>
                  )}
                </td>
                <td style={{ padding: '12px' }}>{votante.cedula}</td>
                <td style={{ padding: '12px' }}>
                  <span
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      background: votante.estado === 'ya_voto' ? '#dcfce7' : '#fef3c7',
                      color: votante.estado === 'ya_voto' ? '#166534' : '#92400e',
                    }}
                  >
                    {votante.estado === 'ya_voto' ? '✅ Ya votó' : '⏳ Pendiente'}
                  </span>
                </td>
                <td style={{ padding: '12px', textAlign: 'center' }}>
                  <button
                    onClick={() => setVotanteSeleccionado(votante)}
                    style={{
                      padding: '6px 12px',
                      background: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    Marcar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {votantesFiltrados.length === 0 && (
        <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
          No hay votantes con esos criterios
        </div>
      )}

      {/* Modal para marcar voto */}
      {votanteSeleccionado && (
        <MarcarVoto
          votante={votanteSeleccionado}
          mesaData={mesaData}
          onClose={() => setVotanteSeleccionado(null)}
        />
      )}
    </div>
  );
}