// Importado PRIMERO en main.tsx: corrige la dirección de un enlace de correo
// antes de que se cree el enrutador (que lee la dirección al crearse).
import { routeEmailLinkNow } from './emailLink'

routeEmailLinkNow()
