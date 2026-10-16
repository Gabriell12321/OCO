# OCO / Quarto 01 — atualização 0.10.0

## Cadeira da escrivaninha

A cadeira foi remodelada para ter uma silhueta doméstica mais convincente:
pernas afiladas, montantes traseiros inclinados, encosto curvo e travessas
com encaixes. Os pés passam a se apoiar no piso. O assento tem volume,
contorno arredondado e costura, em vez da almofada plana anterior.
Vincos curtos de tensão junto às bordas e compressão central assimétrica
dão leitura de estofado usado, com variação discreta de tom na superfície.

O acabamento em nogueira usa reflexos largos e discretos. Os veios seguem
o comprimento de cada peça, e o estofado verde acinzentado mantém a escala
da trama no topo e nas bordas. Os materiais compartilham as fotografias
locais existentes, com configurações próprias para esta cadeira.

## Integração e custo

O modelo é estático, participa dos lotes de geometria e reaproveita a
iluminação e as sombras do quarto. Não há luz adicional, textura nova
nem simulação por quadro. A colisão é calculada a partir dos limites do
modelo já posicionado e girado, para acompanhar as novas curvas.

A malha nova tem 11.628 triângulos e 7.057 vértices em quatro grupos de
material. A antiga tinha 3.680 triângulos e 10.928 vértices: a indexação
reaproveita vértices enquanto acrescenta detalhe nas curvas. A redução de
vértices não é tomada como prova de ganho de FPS; o custo é comparado no
aplicativo, com a mesma câmera e resolução.

O jogo permanece no mesmo quarto, em primeira pessoa, com chuva, áudio,
piscadas do abajur e trovões da versão anterior.

## Revisão e testes

As treze verificações locais passaram, incluindo o novo teste da cadeira:
dimensões, quatro pés no chão, faces visíveis do lado correto, normais,
UVs e apoio do estofado. A almofada tem aproximadamente 50 mm de espessura
central e sua base encontra as travessas com tolerância de poucos
milímetros. A revisão independente do código também passou.

As capturas finais foram revisadas em Desempenho e Qualidade. O encosto
curvo, os pés e o apoio do assento não apresentaram vãos ou artefatos novos.
Os vincos e a variação do tecido são sutis na iluminação do quarto.

Na Intel Iris Xe, em Desempenho a 1004 × 516, as três vistas da cadeira
mantiveram entre 59,98 e 60,06 FPS, com quadro p95 de 16,8 ms. A geometria
mais detalhada acrescentou três draw calls e entre 0,38 e 0,89 ms de GPU
nas amostras comparadas à versão 0.9.0; não se trata de ganho de FPS.

O percurso de 35,06 segundos com caminhada, corrida, mouse, chuva, áudio e
trovão registrou 60,02 FPS, quadro médio de 16,67 ms e p95 de 16,9 ms.
Não houve fases interrompidas, erros ou avisos. Os testes da sombra humana
e da troca dos três perfis gráficos também passaram. Esses números se
referem à máquina, resolução e perfil testados.

As medições completas ficam em [VALIDACAO.md](VALIDACAO.md).
