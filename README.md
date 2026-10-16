# Quarto 01

Um único quarto 3D de terror psicológico, explorado exclusivamente em primeira pessoa: materiais PBR fotográficos, superfícies envelhecidas, luz noturna fria, abajur quente e tecidos com dobras. O cobertor tem caimento arredondado, bainhas e dobras assimétricas. A sombra do jogador usa uma malha humana com pés, mãos e animação esquelética, projetada pela luz do abajur sobre o quarto.

[Baixar a versão Windows](https://github.com/Gabriell12321/OCO/releases/latest). Extraia o ZIP completo e abra `Quarto 01.exe`.

A versão 0.6.1 fecha as aberturas da cabeça na sombra, corrige as projeções
indevidas sobre a cama e remove a poeira flutuante. A sombra respeita a distância
entre a lâmpada, o jogador e cada superfície, e acompanha o deslocamento pelo quarto.

Versão Windows portátil: abra `Windows/Quarto 01/Quarto 01.exe`, na pasta acima deste projeto. Extraia o ZIP inteiro antes de abrir e mantenha o executável junto das demais pastas e arquivos. Node, navegador e conexão à internet não são necessários para usar o programa.

A versão desktop reutiliza as sombras estáticas, controla a resolução interna e limita a apresentação a 60 quadros por segundo. Os perfis **Desempenho**, **Equilibrado** e **Qualidade** permitem trocar a qualidade durante o jogo. O perfil inicial é Desempenho, com resolução adaptativa. O tratamento de cor AgX preserva a transição entre a luz do abajur e as sombras do quarto; FXAA suaviza as bordas depois desse tratamento, sem o custo de MSAA 4×. Veja as medições em [VALIDACAO.md](VALIDACAO.md).

A caminhada acelera e freia suavemente. A passada acompanha a distância realmente percorrida, com deslocamento discreto da câmera na altura dos olhos; ao parar ou encostar em um móvel, os passos cessam. O campo de visão mais contido evita a distorção excessiva de grande-angular. Verniz gasto, tecido iluminado do abajur e preenchimento nas sombras dão mais leitura aos materiais.

O atalho `ABRIR QUARTO.cmd`, na pasta acima, também abre o aplicativo Windows. Para desenvolvimento, `npm start` continua disponível nesta pasta.

- Clique no quarto para controlar o olhar com o mouse; Esc solta o cursor. Arrastar continua disponível como alternativa.
- Use WASD ou as setas para caminhar.
- Shift acelera a caminhada.
- O botão com seta circular restaura a posição inicial.
- O botão ao lado abre tela cheia.
- No celular, arraste para olhar e use os direcionais.

Three.js e as texturas são incluídos localmente. O programa utiliza Electron para executar o renderizador em uma janela própria e não depende de CDNs ou de um servidor local. As fontes e licenças dos materiais estão em ASSETS.md e as das bibliotecas em dist/vendor/. O código do aplicativo e o processo de empacotamento estão em desktop/.

O código é mantido em [Gabriell12321/OCO](https://github.com/Gabriell12321/OCO). Para gerar a versão Windows a partir deste repositório, use Node 22.15 ou superior e execute `node desktop/build.cjs`. O builder baixa o runtime oficial, verifica seu SHA256 e cria a pasta Windows e o ZIP na pasta acima do projeto. As credenciais de publicação permanecem locais e não acompanham o código nem o executável.

Para verificar a geometria e os controles sem navegador, execute `npm test`. As dependências de renderização usadas pelos testes já estão em `dist/vendor/`.
