import { createBrowserRouter } from 'react-router'
import { AppShell } from './AppShell'
import { PublicOnly, RequireAdmin, RequireAuth } from './guards'
import { RouteError } from './RouteError'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { LoginPage, SignupPage, ForgotPasswordPage } from '@/features/auth/AuthPages'
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'
import { ConfirmEmailPage } from '@/features/auth/ConfirmEmail'
import { HomePage } from '@/features/home/HomePage'
import { QuinielaPage } from '@/features/quiniela/QuinielaPage'
import { Navigate } from 'react-router'
import { LeaderboardPage } from '@/features/leaderboard/LeaderboardPage'
import { ProfilePage } from '@/features/profile/ProfilePage'

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        element: <PublicOnly />,
        children: [
          { path: '/entrar', element: <LoginPage /> },
          { path: '/registro', element: <SignupPage /> },
          { path: '/recuperar', element: <ForgotPasswordPage /> },
        ],
      },
      { path: '/restablecer', element: <ResetPasswordPage /> },
      // Vuelta desde el correo de confirmación (funciona con o sin sesión).
      { path: '/auth/confirmar', element: <ConfirmEmailPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: '/', element: <HomePage /> },
              { path: '/quinielas', element: <QuinielaPage /> },
              { path: '/quinielas/:roundId', element: <Navigate to="/quinielas" replace /> },
              { path: '/quinielas/:roundId/jugar', element: <LegacyPlayRedirect /> },
              { path: '/clasificacion', element: <LeaderboardPage /> },
              { path: '/perfil', element: <ProfilePage /> },
            ],
          },
          {
            // Panel exclusivo del administrador (fuera de la navegación de jugadores).
            element: <RequireAdmin />,
            children: [
              {
                path: '/admin',
                lazy: async () => ({ Component: (await import('@/features/admin/AdminShell')).AdminShell }),
                hydrateFallbackElement: <FullPageSpinner />,
                children: [
                  { index: true, lazy: async () => ({ Component: (await import('@/features/admin/AdminNextPool')).AdminNextPool }) },
                  { path: 'equipos', lazy: async () => ({ Component: (await import('@/features/admin/AdminTeams')).AdminTeams }) },
                  { path: 'resultados', lazy: async () => ({ Component: (await import('@/features/admin/AdminResults')).AdminResults }) },
                  { path: 'participantes', lazy: async () => ({ Component: (await import('@/features/admin/AdminPayments')).AdminPayments }) },
                  { path: 'datos-pago', lazy: async () => ({ Component: (await import('@/features/admin/AdminPaymentInfo')).AdminPaymentInfo }) },
                  { path: 'consumo', lazy: async () => ({ Component: (await import('@/features/admin/AdminApiUsage')).AdminApiUsage }) },
                  // Enlaces anteriores del panel.
                  { path: '*', element: <Navigate to="/admin" replace /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' })

/** Enlaces antiguos /jugar: la captura vive ahora en Mi quiniela. */
function LegacyPlayRedirect() {
  return <Navigate to="/quinielas" replace />
}
