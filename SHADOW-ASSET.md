# Silhueta humana do jogador

A sombra usa uma pessoa com malha contínua, esqueleto, mãos, dedos e sapatos
modelados. O corpo é exclusivo do mapa de sombra: o jogo continua inteiramente
em primeira pessoa, sem mostrar uma personagem externa à câmera.

## Origem e condições de uso

- A malha deriva de **Michelle**, personagem Mixamo distribuída no
  [exemplo oficial do Three.js r180](https://github.com/mrdoob/three.js/blob/r180/examples/models/gltf/Michelle.glb).
- As curvas de caminhada e corrida derivam de **Soldier**, também identificado
  como Mixamo pelo
  [exemplo oficial de animação do Three.js r180](https://github.com/mrdoob/three.js/blob/r180/examples/webgl_animation_skinning_blending.html).
- A [FAQ oficial do Adobe Mixamo](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
  permite o uso sem royalties de personagens e animações em projetos pessoais,
  comerciais e sem fins lucrativos, incluindo videogames. Esses ativos são
  incorporados a este jogo e não são apresentados como modelos originais do OCO
  ou como conteúdo de domínio público.
- O Three.js mantém sua licença MIT em `dist/vendor/THREE-LICENSE.txt`.
  Os termos dos personagens Mixamo são distintos da licença da biblioteca.

## Adaptação para este quarto

`dist/assets/player-shadow/human-data.js` contém apenas a malha simplificada,
os ossos, os pesos de deformação e as curvas necessárias. As texturas do modelo,
danças e arquivos GLB completos não entram no carregamento nem no pacote.

A malha foi reduzida de 28.106 para 5.998 triângulos com
[meshoptimizer 1.0](https://github.com/zeux/meshoptimizer/tree/v1.0), usado somente
na conversão. O cabelo foi ajustado ao crânio, o acessório da cabeça foi retirado
e a silhueta da roupa foi ajustada para uma pessoa com roupa comum. O antepé
e o solado foram arredondados, com calcanhar mais estreito; os vértices do
contorno dos dedos são preservados na simplificação. A altura
em repouso é de 1,76 metro.

O repouso usa uma postura neutra entre duas fases opostas da caminhada, com
os braços relaxados. A caminhada e a corrida misturam curvas de movimento;
a fase acompanha a distância efetivamente percorrida, incluindo marcha à ré.
Pequenas amostras da sola mantêm o pé de apoio sobre o piso sem calcular a
caixa de todos os vértices durante o jogo.

O renderizador usa uma única chamada de desenho em um mapa de 512 × 512,
atualizado no máximo 30 vezes por segundo e congelado quando o jogador fica
parado. As sombras estáticas do quarto continuam em cache. Nenhum terceiro
modelo ou textura de personagem é adicionado à renderização principal.

`tests/player-shadow.mjs` verifica índices e pesos da malha, dimensões humanas,
contato dos pés, deformação em diferentes fases e o limite de atualização do
mapa. Os originais e o processo de conversão local ficam em `.setup/`, fora da
distribuição; o arquivo de dados final está versionado com este jogo.
