# OCO / Quarto 01 — atualização 0.11.0

## Câmera corporal

A visão passa a acompanhar o peito a 1,45 m de altura. O campo de visão
mais amplo e a lente com distorção radial suave aproximam a apresentação
da estética de câmera corporal solicitada. A referência visual é
[Bodycam](https://www.playbodycam.com/en-US); a implementação é própria
para o quarto do OCO, sem armas.

A caminhada combina balanço lateral, variação vertical, impactos curtos
dos passos e inclinação na aceleração, na freada e no movimento lateral.
A corrida reforça a passada. O mouse responde diretamente; a acomodação
secundária é breve e limitada. Ao parar, a câmera se estabiliza, sem
tremor aleatório contínuo. Pressionar um móvel ou a parede não gera
passos sem deslocamento. A sombra humana usa a mesma fase de passada.

O FOV vertical de projeção passou de 60° para 76°. A lente curva levemente
as bordas, escurece os cantos e produz uma pequena separação de cor na
periferia. O recorte radial reduz parte
do campo: 76° descreve a câmera antes da lente, não um FOV final retilíneo.
A imagem central e os controles de interface permanecem legíveis.

## Custo e integração

A lente usa o passe de saída HDR existente, antes de AgX/sRGB e FXAA.
Não acrescenta passes, alvos de imagem, texturas, geometria ou luzes.
Ela faz duas leituras adicionais da imagem para a separação periférica
de cor. O campo de visão maior pode mostrar mais geometria; por isso,
o custo é medido tanto no percurso quanto com a lente ligada/desligada
na mesma câmera e resolução.

O controlador subdivide a integração em intervalos de até 1/120 s, com
limites de 34 mm no deslocamento vertical, 25 mm no plano horizontal,
2,18° de roll e 1,49° de inclinação adicional. Pausa, perda de foco e reset
zeram os impulsos. A altura e a postura da sombra não são reduzidas nem
inclinadas junto com a câmera. Chuva, áudio, trovões e os móveis permanecem
integrados à cena.

## Revisão e testes

As quatorze verificações locais passaram. O novo roteiro de controle a
30, 60 e 120 Hz produziu resultados iguais nos pontos comparados, incluindo
corrida, mudança de direção e parada. Foram conferidos mouse, limites,
colisão, pausa e assentamento. A verificação da geometria realizou 135
amostras do campo próximo, em cinco posições e offsets extremos, sem
interseções com os móveis ou paredes.

A revisão independente também conferiu a matemática da lente: 40.401
amostras em cada uma de sete proporções, de 9:16 a 32:9, permaneceram
dentro da imagem, sem valores inválidos ou dependência de bordas esticadas.

As capturas nativas e os quadros de caminhada/corrida foram revisados:
centro legível, bordas preenchidas e nenhuma interseção com móveis nas
vistas testadas. O teste nativo confirmou mouse imediato, assentamento
completo e colisão repetível. A sombra humana e a troca dos três perfis
gráficos passaram sem erros ou avisos.

Na Intel Iris Xe, em Desempenho a 1004 × 516, o percurso válido de 35,05 s
com chuva, áudio e trovão registrou 59,92 FPS. Os trechos em movimento
registraram 59,87 FPS, quadro médio de 16,71 ms e p95 de 16,9 ms. A CPU
média nesses trechos passou de 3,35 ms na referência para 4,24 ms; não se
atribui ganho de FPS à atualização. As medições interrompidas por perda
de foco foram descartadas e repetidas pelo diagnóstico. Esses números
descrevem a máquina, resolução e perfil testados.

Os pares de lente ligada/desligada mantiveram os mesmos passes e draw
calls, com diferenças de GPU dentro da variação observada nas amostras.
As medições completas e suas limitações estão em [VALIDACAO.md](VALIDACAO.md).
