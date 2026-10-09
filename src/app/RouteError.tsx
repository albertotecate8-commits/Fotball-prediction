import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

export function RouteError() {
  const err = useRouteError()
  const notFound = isRouteErrorResponse(err) && err.status === 404
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="card max-w-sm p-6 text-center">
        <p className="scoreline text-6xl text-lime">{notFound ? '404' : '!'}</p>
        <h1 className="display mt-2 text-2xl font-semibold uppercase">{notFound ? 'Página no encontrada' : 'Algo salió mal'}</h1>
        <Link to="/" className="mt-5 inline-flex h-11 items-center rounded-full bg-lime px-5 font-semibold text-bg">Ir al inicio</Link>
      </div>
    </div>
  )
}
