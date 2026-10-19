import { useEffect } from 'react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { isStaleBuildError, reloadForNewBuild } from './staleBuild'

export function RouteError() {
  const err = useRouteError()
  const notFound = isRouteErrorResponse(err) && err.status === 404
  const stale = isStaleBuildError(err)
  useEffect(() => { if (stale) reloadForNewBuild() }, [stale])
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="card max-w-sm p-6 text-center">
        <p className="scoreline text-6xl text-aqua">{notFound ? '404' : '!'}</p>
        <h1 className="display mt-2 text-2xl font-semibold uppercase">{notFound ? 'Página no encontrada' : 'Algo salió mal'}</h1>
        {stale && <p className="mt-2 text-sm text-muted">Hay una versión nueva de la app.</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => window.location.reload()} className="inline-flex h-11 items-center rounded-full bg-red px-5 font-semibold text-white">Recargar</button>
          <Link to="/" className="inline-flex h-11 items-center rounded-full border border-line px-5 font-semibold">Ir al inicio</Link>
        </div>
      </div>
    </div>
  )
}
