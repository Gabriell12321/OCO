# OCO / Quarto 01 — atualização 0.8.0

## Iluminação e atmosfera

A luz fria da janela ganhou mais presença nas superfícies, com preenchimento
ambiente mais contido e contraste com o abajur quente. Os três perfis mantêm
seus limites de iluminação e o tratamento HDR → AgX/sRGB → FXAA.

O abajur apresenta falhas ocasionais do contato elétrico: duas quedas curtas
separadas e uma queda mais longa, distribuídas em ciclos de 32 segundos com
variação entre ciclos. A intensidade da luz, o preenchimento quente, a cúpula,
o filamento e os reflexos nas gotas seguem o mesmo sinal. A recuperação da
luz é gradual. Cada queda dispara um único estalo elétrico sincronizado.

## Chuva e vidro molhado

Filetes de chuva passam fora do quarto, em diferentes profundidades. No lado
externo do vidro aparecem gotas pequenas, impactos e escorrimentos. Os
caixilhos e as paredes ocluem a chuva; não há chuva ou poeira dentro do quarto.
As gotas têm contorno orgânico, bordas translúcidas e pequenos reflexos frios
e quentes. A representação da água é aproximada, sem passe de refração da
tela inteira.

## Som e controles

O áudio é original, gerado localmente uma vez: chuva abafada pela janela,
pingos no vidro e três variações curtas de estalo elétrico. As fontes têm
posição no quarto e acompanham a orientação do jogador. Há suavização de
volume e compressão para evitar estalos de acionamento e saturação.

Clique no quarto, use WASD/setas ou o botão de som para ativar o áudio. O
botão permite silenciar e reativar. Ao minimizar ou tirar o foco do jogo,
o áudio é suspenso; ao voltar, respeita a escolha de som do jogador.

## Orçamento de desempenho

- As piscadas alteram intensidades e emissivos, sem recalcular os sete mapas
  de sombra estáticos do quarto. A sombra humana continua independente.
- A chuva usa dois lotes instanciados: 620 filetes e 220 gotas no perfil
  Desempenho; 1.100 filetes e 380 gotas em Qualidade. São 1.680 a 2.960
  triângulos e nenhuma transferência de geometria ou textura por quadro.
- O áudio mantém dois loops, cinco buffers compartilhados e no máximo quatro
  efeitos breves simultâneos. A posição do ouvinte é atualizada até 30 Hz;
  parado, não agenda novas mudanças.
- A cena, os controles, a cama e a sombra humana preservam as otimizações da
  versão 0.7.0. O jogo permanece exclusivamente em primeira pessoa.

## Organização do código

`dist/engine/room-lighting.js` controla emissores e a sequência de falhas;
`dist/weather/rain.js` desenha chuva e gotas; `dist/audio/room-audio.js`
controla geração e reprodução de áudio. `dist/main.js` integra os módulos,
a pausa e os diagnósticos. O backend continua sendo Three.js/WebGL2.

Os testes e as medições desta versão ficam em [VALIDACAO.md](VALIDACAO.md).
O aplicativo Windows acompanha este documento em `DOCUMENTACAO/`.

## Resultado da revisão e dos testes

As doze verificações locais passaram, assim como os testes nativos de áudio,
sombras, caminhada, corrida, mouse e troca dos três perfis gráficos.
As capturas da janela foram revisadas em Desempenho e Qualidade.

Na Intel Iris Xe, com resolução interna de 1004 × 516, o percurso de 35,07
segundos com chuva, piscadas e áudio ativos registrou **60,02 FPS**, tempo de
quadro p95 de **16,9 ms** e CPU média de **3,44 ms**. O custo da chuva foi
comparado com as mesmas câmeras e resolução, sem alteração mensurável na
fluidez das amostras de quatro segundos. Esses números são específicos desta
máquina e do perfil Desempenho.

O teste confirmou sinal de áudio após ativação, silêncio ao pausar/silenciar
e correspondência entre piscadas e estalos. Uma demora na inicialização do
dispositivo foi isolada: o diagnóstico agora aguarda o relógio real do áudio,
com limite de três segundos, antes de medir. Medições gráficas interrompidas
por perda de foco são rejeitadas e repetidas; não entram nos resultados.
