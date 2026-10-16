# OCO / Quarto 01 — atualização 0.12.0

## Um quarto com sinais de uso

A composição segue uma rotina de leitura e escrita antes de dormir.
O lado da cama próximo ao abajur está mais mexido: travesseiro avançado,
girado e comprimido, edredom recuado 24,1 cm e manta diagonal com um canto
recolhido. O lençol aparece na abertura real do edredom. As camadas
continuam apoiadas umas nas outras e afastadas da estrutura de madeira.

Na escrivaninha, um caderno aberto tem páginas curvas, anotações legíveis,
envelope dobrado e caneta deixada ao lado. Óculos dobrados e marcador
acompanham o livro de cabeceira. Os livros empilhados têm rotações pequenas
e apoios corrigidos; a caneca encosta no tampo, tem interior e alça conectada.

As cortinas têm comprimentos e pregas diferentes. O tapete tem um canto
levemente levantado e franjas irregulares que acompanham sua superfície.
Uma folha do armário fica discretamente aberta sobre uma carcaça real.
As marcas de mãos, umidade e cadeira aparecem junto ao interruptor,
ao peitoril e aos pontos de contato no piso, sem partículas suspensas.

## Luz e materiais

A luz direta do abajur foi reduzida e seu preenchimento indireto aumentado.
A janela e o ambiente ajudam a revelar os meios-tons da madeira, do tecido
e das paredes. Os multiplicadores do reboco e do teto ficaram mais neutros,
e a vinheta da câmera corporal escurece menos os cantos. O clima continua
noturno, com contraste entre a janela fria e o abajur quente.

As falhas elétricas, chuva, trovão e clarão vermelho continuam sincronizados
com o sistema existente. A câmera corporal, primeira pessoa e exploração
do único quarto permanecem integradas a essas mudanças.

## Custo e verificação

Os tecidos mantêm 34.934 triângulos em cinco meshes. Os novos objetos
somam 2.694 triângulos em cinco meshes e um atlas 1024²; as marcas de uso,
420 triângulos em um mesh sem textura. Esse conteúdo é estático. O número
de luzes, mapas de sombra e passes de imagem permanece o mesmo.

As quinze verificações locais passaram, cobrindo geometria, apoios,
controles, sombras, renderização, iluminação, chuva e áudio. O apoio do
caderno, da caneta e dos óculos tem erro menor que 0,24 mm. A revisão
independente conferiu a integração, a transformação das franjas, a porta
do armário dentro da colisão e o suporte de transparência das marcas.
As medições nativas e suas limitações estão em [VALIDACAO.md](VALIDACAO.md).

No aplicativo Windows, os trechos com caminhada, corrida e mouse
registraram 59,67 FPS, quadro médio de 16,77 ms e p95 de 17,0 ms na
Intel Iris Xe, em Desempenho a 1004 × 516. As cinco vistas fixas também
foram comparadas com 0.11.0 e revisadas em Qualidade. A atualização
acrescenta de um a três draw calls nessas vistas; não se atribui a ela
um ganho de FPS. Qualidade exige mais GPU e foi medido separadamente.
