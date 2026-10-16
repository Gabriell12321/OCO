# OCO Engine — base 0.1

A camada própria do OCO separa as regras de renderização do conteúdo do quarto.
O backend continua sendo Three.js/WebGL2, dentro do aplicativo Electron.
Esta é a primeira base da engine do jogo; ela não implementa os sistemas
Nanite ou Lumen da Unreal Engine.

## Renderização

`dist/engine/render-pipeline.js` controla os alvos de imagem e seu ciclo de
vida: cena em HDR linear, tratamento AgX/conversão sRGB uma vez e FXAA após
essa conversão. Redimensionar, trocar de perfil e liberar recursos passam
pelo mesmo módulo. Os caminhos sem FXAA/MSAA permanecem disponíveis para
diagnóstico comparável.

`dist/engine/static-scene.js` compila a cena imutável em lotes por material e
região. Mantém índices de vértices, transformações, normais, sombras e limites
espaciais. Objetos dinâmicos, transparentes, instanciados e com esqueleto não
entram nessa compilação. Geometrias compartilhadas por objetos retidos são
preservadas. O quarto e suas sombras são calculados uma vez; o mapa humano é
independente e acompanha a animação.

`dist/engine/shadow-filter.js` compara cada amostra da sombra pontual com a
profundidade do plano receptor naquela direção. Isso corrige as faixas que o
filtro produzia no tecido sob luz rasante. O perfil Desempenho usa quatro
amostras e Qualidade usa nove; a correção é limitada perto de descontinuidades.
O filtro não acrescenta passagens pela cena. Para refinar o contorno das
dobras, o mapa estático do abajur usa 1024 × 1024 por face, calculado somente
no carregamento ou na troca de perfil. A sombra humana mantém seu mapa
independente de 512 × 512 e o limite de 30 atualizações por segundo.

`dist/engine/resolution-governor.js` usa o FPS e a carga recente da GPU para
ajustar o orçamento de pixels quando a sobrecarga persiste. A recuperação
exige margem sustentada, evitando alternar a resolução continuamente. O
perfil Desempenho também pode reduzir a escala, até o orçamento de 640 × 360
pixels, mantendo a proporção da janela. Os testes de comparação travam essa
escala em 1, para não atribuir a uma otimização o ganho de uma resolução menor.

## Conteúdo e materiais

`dist/engine/room-lighting.js` mantém os emissores fixos e amostra uma sequência
determinística de falhas elétricas. Um único sinal altera luz direta,
preenchimento, emissivos e reflexos na água; o evento de início dispara o som.
As intensidades mudam sem invalidar os mapas estáticos de sombra.

`dist/engine/storm.js` fornece o relógio da tempestade: primeiro evento aos
10 segundos e intervalos posteriores de 27 a 39 segundos. Um envelope com
ataque de 150 ms e cauda de 900 ms controla o clarão vermelho. O início do
mesmo evento aciona o trovão. A luz externa usa o mapa de sombra da janela
já calculado; preenchimento, vidro e gotas seguem o mesmo ganho. Nenhum
emissor, mapa de sombra ou passe de tela é acrescentado.

`dist/weather/rain.js` usa dois lotes instanciados e anima o movimento no
vertex shader. Os filetes ficam fora da janela; gotas e escorrimentos são
recortados no vidro e ocluídos pelas molduras. Não há simulação por gota na
CPU, cópia da imagem nem novo passe de refração.

`dist/audio/room-audio.js` pré-carrega os arquivos de chuva e trovão locais
sem iniciar áudio. Após interação do usuário, decodifica e prepara os
buffers uma vez. Mantém duas fontes contínuas, até quatro estalos curtos e
um trovão. A espacialização acompanha a câmera, o áudio respeita
mute/foco/pausa e a medição de sinal só aloca um analisador temporário quando
solicitada pelo diagnóstico. Uma alternativa procedural cobre falha de
leitura ou decodificação; o snapshot identifica a fonte em uso.

`dist/bedroom/bed.js` gera os tecidos em metros: costuras, abas dos travesseiros,
dobras de tensão, bainhas e a borda retornada do edredom. A densidade da malha
é concentrada onde muda o contorno. Não há simulação de tecido por quadro.

`dist/fabric.js` prepara os mapas de tecido no carregamento. A cor é filtrada
em uma textura; a normal e a rugosidade compartilham outra, com a rugosidade
armazenada no canal alpha linear. Os materiais preservam a iluminação PBR,
as sombras e os mipmaps, com duas leituras de textura em vez de três.

`window.Quarto01.getPerformanceSnapshot()` expõe, no diagnóstico local, o
backend, estatísticas dos lotes, triângulos da cama, resolução, frametimes e
tempos de GPU. A interface do jogo continua dedicada a explorar o quarto.

## Validação

`npm test` verifica os lotes e transformações, a política de resolução, o
ciclo de vida do pipeline, as superfícies da cama e os dados dos materiais,
além dos controles e da sombra humana. O diagnóstico `--benchmark-bed`
compara os mesmos ângulos no aplicativo real. Medições em `VALIDACAO.md`.
