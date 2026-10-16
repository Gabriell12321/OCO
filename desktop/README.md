# Quarto 01 para Windows

Versão 0.7.0, exclusivamente em primeira pessoa. Empacotamento portátil com
Electron oficial 44.7.2 para Windows x64. O usuário
abre `Quarto 01.exe`; Node, navegador, instalação e internet não são necessários.

Todos os perfis suavizam bordas com FXAA. DESEMPENHO prioriza FPS;
EQUILIBRADO aumenta a resolução interna; QUALIDADE usa resolução maior,
iluminação de área e filtro completo de sombras. A troca de perfil não exige
reiniciar o aplicativo. A cena mantém HDR até a conversão AgX/sRGB e o FXAA
trabalha sobre a imagem final, sem MSAA e sem conversão duplicada de cores.

## Build

Na pasta do projeto, com Node 22.15 ou superior:

```powershell
node desktop/build.cjs
```

O builder baixa o runtime oficial somente se não estiver no cache e valida seu
SHA256 contra o valor publicado no `SHASUMS256.txt` da versão fixa. Não instala
pacotes, não modifica a política de execução do Windows e não altera o sistema.

Saídas: `../Windows/Quarto 01/Quarto 01.exe` e `../Quarto 01 Windows.zip`.
O pacote inclui a descrição da OCO Room Engine em `DOCUMENTACAO/ENGINE.md`.

`--refresh` atualiza o conteúdo usando o runtime que já foi extraído. `--skip-zip`
omite a compactação durante as iterações de desenvolvimento.

## Diagnóstico do próprio aplicativo

```powershell
& '../Windows/Quarto 01/Quarto 01.exe' --benchmark '--benchmark-dir=C:\caminho\resultados'
```

O teste espera o quarto carregar, aquece por 5 segundos e mede aproximadamente
35 segundos: parado, andando, girando a câmera, andando e girando, e correndo e
girando. Os comandos passam pelo controlador real do próprio aplicativo.
Cada fase informa FPS realmente renderizados, tempo médio de CPU e tempos
de quadro p95/p99. O teste verifica posições, rotação, corrida, primeira pessoa
e a sombra que acompanha o jogador. A fase da passada precisa avançar com a
distância percorrida em todas as fases de movimento.

Ao concluir, grava `latest.json`, a vista inicial em `latest.png`, a sombra em
`shadow.png`, os pés em `feet.png` e um detalhe do cobertor em `blanket.png`,
e encerra o programa.
O relatório identifica a GPU efetivamente usada pelo contexto WebGL.
`--benchmark-quality=performance`, `balanced` ou `quality` permite medir um
perfil específico.

`--benchmark-no-fxaa` (ou `--fxaa=0`) desativa FXAA para comparar a mesma cena
com o caminho direto de DESEMPENHO/EQUILIBRADO. Nesse diagnóstico, QUALIDADE
recupera o antigo alvo HDR MSAA4. `--benchmark-msaa4` também desativa FXAA e
força MSAA4 no contexto; `--benchmark-no-msaa` é um alias do diagnóstico direto.
Essas opções são comparações técnicas; a execução normal usa FXAA nos três perfis.

`--quality-steady-probe` separa a primeira ativação do perfil QUALIDADE de uma
amostra de 3 segundos já estabilizada, depois verifica a volta a DESEMPENHO.
`--smoke-profile-cycle` valida a troca dos três perfis e o retorno a DESEMPENHO.
`--capture-views-only` compara a sombra ligada e desligada na mesma câmera,
na parede e nos três lados da cama. O teste também anda para frente e para
trás ao lado da cama, mede a distância entre jogador e projeção, retorna à
parede e captura o quarto, o cobertor e os pés nas vistas frontal e oblíqua.
Essas comparações também acompanham o benchmark de 35 segundos.

`--benchmark-bed` mede a vista inicial por 3 segundos e quatro vistas da cama
por 5 segundos cada: lado direito, pés, lado esquerdo e cobertor de perto.
As três últimas incluem rotação suave da câmera. Cada vista informa FPS,
tempos de quadro, CPU e GPU por consulta assíncrona já existente; a captura
retorna à mesma pose exata para facilitar comparações. O teste verifica que
a resolução interna permaneceu fixa, bloqueando a adaptação quando a engine
oferece essa opção de diagnóstico. O resultado inclui os cinco PNGs.
`--capture-bed-surfaces` compara os lados esquerdo e frontal da cama em cinco
modos de material/sombra, mantendo a câmera imóvel para investigar artefatos.
`--capture-bed-base` captura somente o resultado normal nos três lados da cama
e na parede com a sombra do jogador.

Se o shell de desenvolvimento herdou `ELECTRON_RUN_AS_NODE=1`, remova essa
variável apenas do processo que iniciará o teste. O atalho `ABRIR QUARTO.cmd`
prepara esse ambiente para a execução normal.

O programa serve seus próprios arquivos pelo protocolo `app://quarto`. O
renderer está em sandbox, sem integração Node e com isolamento de contexto.
O único IPC exposto recebe relatórios de desempenho. Requisições externas,
novas janelas e navegação remota são bloqueadas.

Fontes: [release oficial do Electron](https://github.com/electron/electron/releases/tag/v44.7.2),
[protocolo local](https://www.electronjs.org/docs/latest/api/protocol),
[segurança](https://www.electronjs.org/docs/latest/tutorial/security).
