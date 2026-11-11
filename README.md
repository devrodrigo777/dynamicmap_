# Mapa da fábrica

Mapa 2D interativo de uma planta de fábrica. **React + Node + SQLite, 100% offline.**

- **Visualização** (`/`): pan/zoom com mouse e toque (pinça), áreas clicáveis, animação de zoom até a área e transição para a imagem de detalhe, breadcrumb e botão de voltar (que "afasta" de volta para a área de origem).
- **Admin** (`/admin`): enviar/trocar imagens, desenhar áreas (polígono ou retângulo), ajustar vértices, mover áreas, definir nome, código, descrição, cor, opacidade, rótulo e **qual imagem abrir ao clicar**. Qualquer imagem pode ter áreas que levam a outras imagens (níveis ilimitados).

## Requisitos

Node.js 18 ou superior. A instalação das dependências (`npm install`) precisa de internet **uma vez**; depois disso o sistema roda sem rede nenhuma (sem CDN, fontes ou APIs externas).

## Como rodar

```bash
npm install
npm run seed     # opcional: cria uma planta de exemplo com um nível de detalhe
npm run dev      # desenvolvimento: web em http://localhost:5173, API em :3001
```

Produção (um único processo, serve a API e o site):

```bash
npm run build
npm start        # http://localhost:3001  (PORT=8080 npm start para trocar a porta)
```

O servidor escuta em `0.0.0.0`: tablets e celulares na mesma rede abrem `http://IP-DO-PC:3001`.

## Como usar o admin

1. **Enviar imagem** → planta geral (a primeira vira a tela inicial). Envie também as imagens de detalhe.
2. Escolha **Polígono** (toque para marcar cantos; toque no primeiro ponto ou em *Concluir* para fechar) ou **Retângulo** (dois toques nos cantos opostos).
3. Com a área selecionada: arraste os pontos para ajustar, arraste os pontos claros nas arestas para criar novos cantos, duplo clique/toque num ponto para removê-lo, arraste o corpo da área para movê-la.
4. No painel à direita, escolha **Ao clicar, abrir** a imagem de detalhe.
5. **Salvar**. Atalhos: `Esc` cancela, `Enter` fecha o polígono, `Backspace` remove o último ponto, `Delete` apaga a área.

## Estrutura

```
server/src/db.js      banco SQLite (better-sqlite3) + migrações por PRAGMA user_version
server/src/index.js   API REST, upload de imagens, serve client/dist
server/src/seed.js    dados de exemplo
server/data/          factory.db + uploads/  (faça backup copiando esta pasta)
client/src/hooks/usePanZoom.js   gestos de mouse/toque e animações
client/src/components/MapStage   imagem + camada SVG de áreas
client/src/components/Editor     editor de áreas do admin
client/src/pages/Viewer          tela de visualização e transição entre imagens
```

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/maps` | lista plantas (com contagem de áreas) |
| GET | `/api/maps/root` | planta inicial + áreas |
| GET | `/api/maps/:id` | planta + áreas |
| POST | `/api/maps` | envia imagem (`multipart`: `image`, `name`) |
| PATCH | `/api/maps/:id` | `{ name }` e/ou `{ is_root: true }` |
| PUT | `/api/maps/:id/image` | troca a imagem (as áreas são mantidas) |
| PUT | `/api/maps/:id/areas` | substitui todas as áreas da planta |
| DELETE | `/api/maps/:id` | exclui planta e imagem |

## Modelo de dados

- `maps(id, name, image, width, height, is_root, ...)`
- `areas(id, map_id, name, code, description, points, color, opacity, show_label, target_map_id, sort_order)`

Os pontos são guardados **normalizados (0 a 1)**, então continuam corretos se a imagem for trocada por outra com resolução diferente (mas mesma proporção).

## Próximos passos (já preparados)

- **Importação de Excel**: a coluna `areas.code` é a chave para casar linhas da planilha com áreas. Crie uma migração nova em `db.js` (ex.: tabelas `metrics`/`readings` com `area_code`) e uma rota de upload `.xlsx` (ex.: biblioteca `exceljs` ou `xlsx`, ambas funcionam offline).
- **Gráficos e métricas**: o painel `.info` do `Viewer.jsx` é onde mostrar os dados da área clicada; para gráficos offline use `recharts` ou `chart.js` (empacotados no build, sem CDN).
- **Autenticação do admin**: hoje `/admin` é aberto. Se a rede da fábrica for compartilhada, proteja `/api` (métodos de escrita) e `/admin` com login antes de colocar em produção.
