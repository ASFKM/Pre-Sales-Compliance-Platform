import { useEffect } from "react";
import { userManager } from "../auth/oidc";

/**
 * Mantém o token de acesso renovado em segundo plano.
 *
 * Fase 13 — antes isto batia em `POST /api/auth/refresh`, que rodava o mecanismo próprio de
 * família de refresh token com detecção de reuso. Esse mecanismo saiu junto com o login próprio:
 * quem renova agora é o Keycloak, que faz o mesmo com revogação a cada uso
 * (`revokeRefreshToken` e `refreshTokenMaxReuse: 0` no realm).
 *
 * O `UserManager` já cuida da renovação sozinho (`automaticSilentRenew`). O que este hook faz é
 * o elo que falta: copiar o token novo para `localStorage`, de onde o interceptor global de
 * `fetch` o lê. Sem isso a renovação aconteceria e ninguém usaria o resultado — as requisições
 * continuariam saindo com o token velho até ele expirar, e só então a pessoa cairia para fora.
 */
export function useSilentRefresh(enabled: boolean, onFailure: () => void) {
  useEffect(() => {
    if (!enabled) return;

    const aoCarregar = (user: { access_token: string }) => {
      localStorage.setItem("ca_session_token", user.access_token);
    };

    /**
     * Falha de renovação é o fim da sessão: o refresh token expirou, foi revogado, ou o Keycloak
     * está fora do ar. Dispara o mesmo caminho de saída que qualquer 401 já dispara, em vez de
     * deixar a pessoa numa tela que silenciosamente para de funcionar.
     */
    const aoFalhar = () => {
      localStorage.removeItem("ca_session_token");
      onFailure();
    };

    userManager.events.addUserLoaded(aoCarregar);
    userManager.events.addSilentRenewError(aoFalhar);
    userManager.events.addAccessTokenExpired(aoFalhar);

    return () => {
      userManager.events.removeUserLoaded(aoCarregar);
      userManager.events.removeSilentRenewError(aoFalhar);
      userManager.events.removeAccessTokenExpired(aoFalhar);
    };
  }, [enabled, onFailure]);
}
