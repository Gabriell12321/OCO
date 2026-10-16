# OCO / Quarto 01 — atualização 0.9.0

## Chuva com gravação natural

A camada principal de chuva agora usa uma gravação feita de dentro de um
quarto, em vez do ruído sintético anterior. A transição do loop é suavizada
em memória e os níveis passam por filtros e compressão. Os pingos
suplementares perderam os osciladores tonais que davam um som eletrônico.

Os arquivos são incluídos no jogo e funcionam sem internet. As gravações
de chuva de Anthousai e de trovão de Fission9 são CC0; fontes, licenças,
tamanhos e hashes estão em [ASSETS.md](ASSETS.md).

## Trovão e clarão vermelho

O primeiro trovão ocorre aos dez segundos de exploração. Os seguintes
aparecem em intervalos de 27 a 39 segundos. O mesmo evento dispara o som
e um clarão vermelho vindo da janela, com ataque de 150 ms e recuperação
suave durante 900 ms. A luz atinge os materiais, respeita as sombras da
moldura e se reflete no vidro, nas gotas e nos filetes de chuva.

O clarão reaproveita a iluminação existente. Não acrescenta emissores,
mapas de sombra ou uma camada vermelha sobre a interface. A tempestade
acompanha o relógio do jogo, que para quando o aplicativo fica pausado.

## Áudio e desempenho

O pré-carregamento apenas lê os arquivos locais. Clique no quarto ou use
um comando para ativar o áudio. O botão de som continua permitindo
silenciar. Minimizar ou perder o foco suspende a reprodução; efeitos
transitórios são encerrados, sem reproduzir um trovão antigo ao voltar.

São mantidos dois loops contínuos, até quatro estalos elétricos e somente
um trovão simultâneo. As gravações são preparadas uma vez; nenhuma
decodificação ocorre durante os trovões. Há alternativa procedural para
falha de leitura ou decodificação, identificada no diagnóstico.

Os dois lotes de chuva e o cache de sombras são preservados. O jogo
continua no mesmo quarto e exclusivamente em primeira pessoa.

## Revisão e validação

As doze verificações locais e a revisão independente do código passaram.
O aplicativo Windows confirmou as duas gravações locais e um evento de
trovão junto ao clarão. O ataque do trovão apresentou pico de 0,340 na
saída medida, sem saturação; mute e pausa não deixaram efeitos atrasados.
A chuva tem ciclo de 22,4 s. Foram retirados 530 ms de início do arquivo
de trovão para que o ataque acompanhe a luz, mantendo uma cauda de 7 s.

As capturas do clarão foram revisadas em Desempenho e Qualidade. As
comparações com o clarão ligado/desligado mantiveram o mesmo número de
draw calls e triângulos. A sombra humana e a troca dos três perfis passaram.

Na Intel Iris Xe, em Desempenho com resolução interna de 1004 × 516, o
percurso de 35,08 s com caminhada, corrida, mouse, chuva, áudio e trovão
registrou **60,01 FPS**, quadro **p95 de 16,8 ms** e CPU média de **3,22 ms**.
Não houve pausas, repetições de fase, erros ou avisos nessa execução.
São medidas desta máquina e deste perfil, sem garantia para outros
equipamentos. O relatório completo fica em [VALIDACAO.md](VALIDACAO.md).
