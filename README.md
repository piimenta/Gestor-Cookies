# Caixinha de Cookies 🍪

Controle de "fiado" para a caixa de cookies: um QR code na caixa abre o site, a pessoa diz quem é,
o que pegou, e paga por Pix (copia e cola ou QR) quando quiser. Eu acompanho tudo num painel com PIN.

```
[Celular] --QR--> [Site estático na Vercel] --fetch--> [Google Apps Script] --> [Google Planilha]
```

Custo zero: sem servidor, sem build, sem framework.

| Página | Para quê |
|---|---|
| `/` (`index.html`) | Tela do cliente (aberta pelo QR da caixa) |
| `/#conta` | Abre direto em "Ver minha conta / pagar" (é o link que vai na cobrança do WhatsApp) |
| `/admin.html` | Painel com PIN: quem deve, confirmar Pix, dinheiro, histórico |
| `/qr.html` | Cartaz com o QR da caixa para imprimir (A6 ou A5) |

---

## Setup (uma vez só)

### 1. Planilha + Apps Script

1. Crie uma planilha Google em branco chamada **Cookies**.
2. Na planilha: **Extensões → Apps Script**. Apague o que tiver lá, cole o conteúdo inteiro de
   [`apps-script/Code.gs`](apps-script/Code.gs) e salve (💾).
3. No seletor de funções lá em cima, escolha **`setup`** e clique em **Executar**.
   O Google vai pedir autorização: *Revisar permissões → sua conta → Avançado → Acessar (não seguro) → Permitir*.
   É normal, o script é seu.
4. Volte para a planilha. Foram criadas as abas `Config`, `Sabores`, `Pessoas`, `Registros` e `Pagamentos`,
   já com o cardápio e os dados do Pix. **Confira a aba `Config`:**

   | chave | o que pôr |
   |---|---|
   | `pix_chave` | Sua chave Pix. CPF/CNPJ só com números; telefone **com +55** (`+5545999999999`); e-mail; ou chave aleatória |
   | `pix_nome` | Seu nome como no banco, máx. 25 letras, sem acento |
   | `pix_cidade` | Sua cidade, máx. 15 letras, sem acento |
   | `titulo` | Texto grande do topo do site |
   | `subtitulo` | Linha pequena embaixo do título |

   > Se a chave for telefone, coloque o `+55`. Sem ele, 11 dígitos são lidos como CPF.

5. Na aba `Sabores`, ajuste o cardápio quando quiser. Só aparece no site quem está com `ativo` = `TRUE`.
   O `id` não pode mudar depois que já houver registros com ele (para tirar um sabor, use `ativo = FALSE`).
6. A aba `Pessoas` tem um "Fulano" de exemplo: apague e coloque o nome do pessoal (um por linha, `origem` = `lista`).
   Quem não estiver na lista pode se cadastrar pelo site (`origem` = `auto`).

### 2. PIN do painel

No Apps Script: **⚙️ Configurações do projeto → Propriedades do script → Adicionar propriedade**

- Propriedade: `ADMIN_PIN`
- Valor: um PIN de 4 a 6 dígitos

O PIN fica só no Google, nunca no código do site. Depois de 10 tentativas erradas o painel trava por 15 minutos.

### 3. Publicar a API

1. No Apps Script: **Implantar → Nova implantação → ⚙️ Tipo: App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
2. **Implantar** e copie a URL `https://script.google.com/macros/s/.../exec`.
3. Teste abrindo a URL no navegador: deve aparecer `{"ok":true}`.
4. Cole a URL em [`js/config.js`](js/config.js):

   ```js
   export const API_URL = 'https://script.google.com/macros/s/XXXX/exec';
   ```

> ⚠️ **Sempre que alterar o `Code.gs`:** *Implantar → Gerenciar implantações → ✏️ Editar → Versão: **Nova versão** → Implantar*.
> Assim a URL continua a mesma. Criar outra "Nova implantação" gera uma URL diferente (e o site para de funcionar até você trocar no `config.js`).
>
> Alterar a **planilha** (preços, sabores, nomes, Pix) não precisa reimplantar: vale na hora.

### 4. Site na Vercel

1. Suba esta pasta para um repositório no GitHub.
2. Na Vercel: **Add New → Project → importe o repositório**
   - Framework Preset: **Other**
   - Build Command: *(vazio)*
   - Output Directory: *(vazio / raiz)*
3. Deploy. Cada `git push` publica de novo sozinho.

O `.vercelignore` deixa `apps-script/`, `tests/`, `README.md` e `package.json` fora do site publicado.

### 5. Testar o Pix ANTES de colar na caixa

1. Abra o site no celular, registre um cookie com seu nome e vá em "Pagar agora".
2. Toque em **Copiar Pix copia e cola** e cole no app do banco (Pix → Pix copia e cola).
3. Confira se aparecem **seu nome, sua chave e o valor certo**. Pode até pagar R$ 0,01 para você mesmo.
4. Teste também lendo o QR do Pix com a câmera de outro celular.
5. Depois, no painel, cancele o registro de teste.

### 6. Cartaz da caixa

Abra `https://SEU-PROJETO.vercel.app/qr.html`, escolha A6 ou A5, imprima e cole na caixa.
Tem a opção "Economizar tinta" (fundo branco). Na janela de impressão, deixe a escala em 100% e
marque "Gráficos de plano de fundo" se o fundo verde não aparecer.

---

## Dia a dia

- **Alguém pagou por Pix e clicou "Já paguei":** aparece em destaque no topo do painel.
  Confira no extrato do banco e clique ✅ **Confirmar** (sai da dívida) ou ❌ **Rejeitar** (a dívida continua).
- **Pagou em dinheiro:** na pessoa, **💵 Recebi em dinheiro**.
- **Registro errado:** clique no nome da pessoa → histórico → **Cancelar** no registro.
  A própria pessoa consegue "Desfazer" pelo celular dela por até 10 minutos.
- **Cobrar:** **💬 Cobrar no WhatsApp** abre a mensagem pronta; você escolhe o contato.
  Fica vermelho com ⚠️ quem tem compra não paga há mais de 7 dias.
- **Mudar preço:** edite a aba `Sabores`. O histórico não muda: cada registro guarda o preço do momento.
- A planilha é o banco de dados: dá para olhar e corrigir à mão. Só não renomeie as abas nem os cabeçalhos.

### Como o saldo é calculado

```
saldo    = soma dos Registros "ativo"  − soma dos Pagamentos "confirmado"
pendente = soma dos Pagamentos "aguardando"
```

Os nomes são comparados sem diferenciar maiúsculas/minúsculas e ignorando espaços nas pontas.

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Site mostra "API não configurada" | Faltou colar a URL em `js/config.js` (e dar push) |
| "Não consegui carregar" / "Sem conexão" | Implantação não está com acesso **Qualquer pessoa**, ou a URL é a de teste (`/dev`) em vez da `/exec` |
| Mudei o `Code.gs` e nada mudou | Faltou *Gerenciar implantações → Nova versão* |
| "Aba X não encontrada" | Rode `setup()` de novo (ele não apaga dados existentes) |
| Banco recusa o Pix | Confira `pix_chave` (telefone com `+55`), `pix_nome` e `pix_cidade` sem acento e dentro do limite |
| "ADMIN_PIN não configurado" | Crie a propriedade do script (passo 2) |
| Primeira abertura do dia demora | O Apps Script "acorda" devagar (alguns segundos). As próximas são rápidas, e o site guarda o cardápio em cache |

---

## Teste local (sem Google)

```bash
npm run dev        # http://localhost:5500  (precisa só do Node 18+)
```

Enquanto `js/config.js` não tiver a URL real, o site entra no **modo teste**: uma faixa amarela no topo avisa,
e o próprio `apps-script/Code.gs` roda dentro do navegador com uma planilha falsa guardada no `localStorage`
(com algumas pessoas e compras de exemplo). Dá para testar tudo: registrar, desfazer, Pix, "Já paguei", painel.

- PIN do painel no modo teste: **1234**
- **Zerar dados** (na faixa amarela) apaga tudo e recomeça com os exemplos.
- No celular, na mesma rede Wi-Fi: use o endereço que o `npm run dev` mostra, com `?demo` no final.
- Com a URL real já configurada, `http://localhost:5500/?demo` ainda força o modo teste.

O modo teste (`js/demo.js`) e o `tools/` não vão para a Vercel (`.vercelignore`).

## Desenvolvimento

Sem build. Não abra os `.html` direto pelo arquivo (`file://`): os `import` de módulo só funcionam via servidor (`npm run dev`).

Testes (Node 18+): gerador do Pix (CRC16, campos EMV) e o `Code.gs` rodando sobre uma planilha falsa em memória
(saldo, desfazer, PIN, validações, preço congelado).

```bash
npm test
```

```
├── index.html / admin.html / qr.html
├── css/style.css
├── js/
│   ├── config.js    URL da API (única coisa a editar)
│   ├── api.js       fetch para o Apps Script (sem Content-Type, para não disparar preflight CORS)
│   ├── pix.js       BR Code Pix estático (EMV + CRC16-CCITT-FALSE)
│   ├── qr.js        QR em SVG (lib qrcode-generator via CDN)
│   ├── app.js       tela do cliente
│   ├── admin.js     painel
│   └── demo.js      modo teste local (API falsa no navegador)
├── apps-script/Code.gs   backend (colar no Apps Script)
├── tools/serve.mjs       servidor local (npm run dev)
└── tests/
```
