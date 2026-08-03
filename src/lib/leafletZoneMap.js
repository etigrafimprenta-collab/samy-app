// Wrapper de Leaflet + OpenStreetMap para "Zonas de búsqueda" (Choferes).
// Aislado en su propio módulo (en vez de meter Leaflet directo en
// chofer-candidate.js) porque necesita 2 arreglos específicos del
// bundler que no tienen que ver con la lógica de negocio de la pestaña:
//  1. Los íconos default de Leaflet apuntan a rutas relativas que Vite no
//     resuelve solas — hay que importarlos como asset y pisar la opción.
//  2. Nominatim (geocoder gratis de OSM, sin API key) para "Buscar
//     dirección" — mismo motor que las teselas del mapa, coherente con la
//     decisión de no usar Google Maps JS API (confirmada con el usuario).
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl })

const DEFAULT_CENTER = [-25.2637, -57.5759] // Asunción, Paraguay
const DRIVER_ICON = L.divIcon({
  html: '🚗',
  className: 'zone-driver-icon',
  iconSize: [28, 28],
  iconAnchor: [14, 14]
})
const STATUS_COLORS = {
  RESERVADO: '#ff9800',
  ASIGNADO: '#2e7d32',
  CANCELADO: '#999'
}

// Mismo patrón de extracción que ya usa campaign.js (.../@lat,lng... o
// ...q=lat,lng...) — se reutiliza acá para el punto central de la zona.
export function extractLatLngFromMapsUrl(url) {
  const match = String(url || '').match(/(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/)
  if (!match) return null
  return { latitude: parseFloat(match[1]), longitude: parseFloat(match[2]) }
}

// Nominatim: uso liviano (1 búsqueda por click de usuario, escala de
// campaña, no de scraping masivo) — respeta la política de uso público
// de OSM sin necesitar key ni backend propio.
export async function geocodeAddress(queryText) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(queryText)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('No se pudo buscar la dirección')
  const results = await res.json()
  if (results.length === 0) return null
  return {
    latitude: parseFloat(results[0].lat),
    longitude: parseFloat(results[0].lon),
    displayName: results[0].display_name
  }
}

// Mapa EDITABLE para "Crear/Editar zona": click en el mapa o
// setCenter()/setRadius() programático (desde geolocalización, link de
// Maps o buscador de dirección) mueven el marcador central y el círculo.
export function initZoneMap(container, { lat, lng, radiusMeters, onPointSelected } = {}) {
  const initialLat = lat ?? DEFAULT_CENTER[0]
  const initialLng = lng ?? DEFAULT_CENTER[1]

  const map = L.map(container).setView([initialLat, initialLng], lat ? 15 : 12)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
  }).addTo(map)

  const marker = L.marker([initialLat, initialLng], { draggable: true }).addTo(map)
  const circle = L.circle([initialLat, initialLng], {
    radius: radiusMeters || 500,
    color: '#1976d2',
    fillColor: '#1976d2',
    fillOpacity: 0.12
  }).addTo(map)

  function setPoint(newLat, newLng, { silent = false } = {}) {
    marker.setLatLng([newLat, newLng])
    circle.setLatLng([newLat, newLng])
    if (!silent && onPointSelected) onPointSelected(newLat, newLng)
  }

  map.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng))
  marker.on('dragend', () => {
    const pos = marker.getLatLng()
    setPoint(pos.lat, pos.lng)
  })

  return {
    setCenter(newLat, newLng, opts) {
      setPoint(newLat, newLng, opts)
      map.setView([newLat, newLng], 15)
    },
    setRadius(meters) {
      circle.setRadius(meters)
    },
    getCenter() {
      const pos = marker.getLatLng()
      return { latitude: pos.lat, longitude: pos.lng }
    },
    invalidateSize() {
      map.invalidateSize()
    },
    destroy() {
      map.remove()
    }
  }
}

// Mapa DE SOLO LECTURA para "Ver en mapa": círculo de la zona + marcador
// del chofer (ícono distinto) + marcadores de votantes coloreados según
// assignmentStatus (punto 6 del pedido).
export function initReadOnlyZoneMap(container, { lat, lng, radiusMeters, voters = [] }) {
  const map = L.map(container).setView([lat, lng], 14)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
  }).addTo(map)

  L.circle([lat, lng], {
    radius: radiusMeters,
    color: '#1976d2',
    fillColor: '#1976d2',
    fillOpacity: 0.1
  }).addTo(map)
  L.marker([lat, lng], { icon: DRIVER_ICON }).addTo(map).bindPopup('Punto central de la zona')

  voters.forEach((v) => {
    if (typeof v.latitude !== 'number' || typeof v.longitude !== 'number') return
    const color = STATUS_COLORS[v.assignmentStatus] || '#1976d2'
    L.circleMarker([v.latitude, v.longitude], {
      radius: 7,
      color,
      fillColor: color,
      fillOpacity: 0.85
    })
      .addTo(map)
      .bindPopup(`<strong>${v.nombre || ''}</strong><br>${v.assignmentStatus || ''}`)
  })

  return {
    invalidateSize() {
      map.invalidateSize()
    },
    destroy() {
      map.remove()
    }
  }
}
