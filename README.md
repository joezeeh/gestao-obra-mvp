# Controle de Obra - MVP 1

Este prototipo e um web app estatico para validar o fluxo de apontamento por unidade.

## Como abrir no computador

1. Dê dois cliques em `ABRIR_APP.bat`.
2. Se preferir, abra o arquivo `index.html` no navegador.
3. Cadastre a obra, pavimentos, unidades e etapas.
4. Use a aba `Apontamento` para marcar as unidades concluidas.
5. Use a aba `Conferencia` para revisar o progresso por etapa.

Os dados ficam salvos no navegador usando `localStorage`.

## Como rodar em qualquer computador com Node.js

1. Instale o Node.js LTS.
2. Copie esta pasta para o computador.
3. Abra o terminal dentro da pasta.
4. Rode `npm start`.
5. Abra `http://127.0.0.1:5173` no navegador.

Este modo usa o arquivo `server.js` e nao precisa instalar dependencias.

## Como testar no celular

Para usar em outro celular, o ideal e publicar o app em uma hospedagem simples, como Vercel, Netlify ou GitHub Pages.

Enquanto ainda for prototipo, tambem e possivel rodar um servidor local na mesma rede Wi-Fi e abrir o endereco pelo celular.

## Limites desta versao

- Nao tem login.
- Nao tem banco de dados compartilhado.
- Nao sincroniza com MS Project.
- Nao resolve conflitos entre duas pessoas marcando ao mesmo tempo.

Essas partes entram na proxima fase.
