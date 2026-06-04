// CrearUsuario.tsx
import React, { useState } from 'react'
import { httpsCallable, getFunctions } from 'firebase/functions'
import { getAuth } from 'firebase/auth'

export function CrearUsuario() {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rol, setRol] = useState('user')
  const [cargando, setCargando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  const functions = getFunctions()
  const auth = getAuth()

  const handleCrearUsuario = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMensaje('')
    setCargando(true)

    try {
      // Verificar que el usuario está autenticado
      if (!auth.currentUser) {
        throw new Error('Debes iniciar sesión primero')
      }

      // Llamar la Cloud Function
      const crearNuevoUsuario = httpsCallable(functions, 'crearNuevoUsuario')
      const result = await crearNuevoUsuario({
        nombre,
        email,
        password,
        rol
      })

      // Éxito
      setMensaje(`✅ ${result.data.mensaje}`)
      setNombre('')
      setEmail('')
      setPassword('')
      setRol('user')
    } catch (err: any) {
      // Error
      let mensajeError = 'Error al crear el usuario'

      if (err.code === 'permission-denied') {
        mensajeError = '❌ No tienes permisos. Solo admins pueden crear usuarios'
      } else if (err.code === 'already-exists') {
        mensajeError = `❌ El email ya existe`
      } else if (err.code === 'invalid-argument') {
        mensajeError = `❌ ${err.message}`
      } else if (err.code === 'unauthenticated') {
        mensajeError = '❌ Debes iniciar sesión'
      } else {
        mensajeError = err.message || mensajeError
      }

      setError(mensajeError)
      console.error(err)
    } finally {
      setCargando(false)
    }
  }

  return (
    <div style={{ maxWidth: '500px', margin: '20px auto', padding: '20px' }}>
      <h2>Crear Nuevo Usuario</h2>

      {mensaje && (
        <div
          style={{
            padding: '12px',
            background: '#d4edda',
            color: '#155724',
            borderRadius: '4px',
            marginBottom: '16px'
          }}
        >
          {mensaje}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '12px',
            background: '#f8d7da',
            color: '#721c24',
            borderRadius: '4px',
            marginBottom: '16px'
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleCrearUsuario}>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
            Nombre
          </label>
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              boxSizing: 'border-box',
              fontSize: '14px'
            }}
            placeholder="Ej: Juan Pérez"
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              boxSizing: 'border-box',
              fontSize: '14px'
            }}
            placeholder="Ej: juan@email.com"
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
            Contraseña (mínimo 6 caracteres)
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              boxSizing: 'border-box',
              fontSize: '14px'
            }}
            placeholder="••••••"
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
            Rol
          </label>
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              boxSizing: 'border-box',
              fontSize: '14px'
            }}
          >
            <option value="user">Usuario Normal</option>
            <option value="moderador">Moderador</option>
            <option value="admin">Administrador</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={cargando}
          style={{
            width: '100%',
            padding: '12px',
            background: cargando ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: cargando ? 'not-allowed' : 'pointer',
            fontSize: '16px',
            fontWeight: '600',
            transition: 'background 0.3s'
          }}
        >
          {cargando ? 'Creando usuario...' : 'Crear Usuario'}
        </button>
      </form>

      <p style={{ marginTop: '20px', fontSize: '12px', color: '#666' }}>
        💡 <strong>Nota:</strong> Solo los administradores pueden crear usuarios. 
        Si ves "No tienes permisos", tu usuario actual no es admin.
      </p>
    </div>
  )
}
