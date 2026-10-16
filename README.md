# Quarto 01

Um único quarto 3D de terror psicológico, explorado exclusivamente em primeira pessoa: materiais PBR fotográficos, superfícies envelhecidas, luz noturna fria, abajur quente e tecidos com dobras. O cobertor tem uma malha detalhada, com caimento arredondado, bainhas e dobras assimétricas. A sombra articulada do jogador acompanha os movimentos, projetada pela luz do abajur sobre o quarto.

[Baixar a versão Windows](https://github.com/Gabriell12321/OCO/releases/latest). Extraia o ZIP completo e abra `Quarto 01.exe`.

Versão Windows portátil: abra `Windows/Quarto 01/Quarto 01.exe`, na pasta acima deste projeto. Extraia o ZIP inteiro antes de abrir e mantenha o executável junto das demais pastas e arquivos. Node, navegador e conexão à internet não são necessários para usar o programa.

A versão desktop reutiliza as sombras estáticas, controla a resolução interna e limita a apresentação a 60 quadros por segundo. Os perfis **Desempenho** e **Equilibrado** usam renderização direta para priorizar a fluidez; **Qualidade** aumenta a resolução e suaviza as bordas com MSAA 4×. É possível trocar de perfil durante o jogo. O perfil inicial é Desempenho, com resolução adaptativa. A câmera fica na altura dos olhos e a caminhada respeita as colisões dos móveis. O tratamento de cor AgX preserva a transição entre a luz do abajur e as sombras do quarto.

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
