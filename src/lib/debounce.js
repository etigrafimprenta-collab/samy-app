export function debounce(fn, wait = 250) {
  let timer = null
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}

// A diferencia de debounce() (que reinicia el timer en cada llamada y
// nunca dispara si las llamadas no paran), throttle() garantiza como
// MÁXIMO una ejecución cada `wait` ms, sin importar cuántas llamadas
// lleguen en el medio — la última llamada "pendiente" durante la pausa
// se ejecuta al final de la ventana, para no perder el estado más
// reciente. Pensado para listeners de Firestore con mucha actividad
// concurrente (ver listenAllRecords/listenAllElectionDayControl en
// dia-d-control-candidate.js) donde un debounce corto puede recargar
// todo demasiado seguido, y uno largo puede no disparar nunca si la
// actividad no para.
export function throttle(fn, wait = 250) {
  let lastRun = 0
  let timer = null
  let pendingArgs = null
  return (...args) => {
    const now = Date.now()
    const elapsed = now - lastRun
    pendingArgs = args
    if (elapsed >= wait) {
      // Si había un timer pendiente de una llamada anterior (ya cubierta
      // por este disparo inmediato, que usa los args más recientes), hay
      // que cancelarlo — si no, dispara después con pendingArgs ya en
      // null (lo acabamos de limpiar acá abajo) y revienta.
      if (timer) { clearTimeout(timer); timer = null }
      lastRun = now
      pendingArgs = null
      fn(...args)
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null
        lastRun = Date.now()
        const argsToRun = pendingArgs
        pendingArgs = null
        fn(...argsToRun)
      }, wait - elapsed)
    }
  }
}
