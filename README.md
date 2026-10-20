# Controle de Gastos — Uso e Consumo

Aplicação de controle de solicitações e propostas de compra feita com HTML, CSS e JavaScript, usando Firebase Authentication anônima e Cloud Firestore. Não há tela de login: o acesso anônimo é criado automaticamente no navegador.

## Preparar o Firebase

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/).
2. Em **Authentication > Sign-in method**, habilite o provedor **Anônimo**.
3. Em **Firestore Database**, crie um banco de dados.
4. Em **Configurações do projeto > Seus apps**, crie um app da Web e copie a configuração.
5. Substitua os valores de exemplo em `firebase-config.js` pelos valores do seu app.
6. No Firestore, abra a aba **Regras**, publique o conteúdo do arquivo `firestore.rules`.
7. Em Authentication > Settings > Authorized domains, adicione o domínio onde o site ficará hospedado.

Os registros são armazenados em `users/{uid}/expenses`; as regras permitem que cada sessão anônima consulte, crie e exclua somente os próprios registros. Assim, os dados não ficam públicos. A sessão e os registros estão associados ao navegador em que foram criados; ao usar outro navegador ou limpar os dados do navegador, a sessão e o acesso aos registros anteriores podem se perder.

## Executar localmente

Como a aplicação usa módulos JavaScript, abra os arquivos por um servidor HTTP local (não diretamente com `file://`). Por exemplo, com Node.js instalado:

```sh
npx serve .
```

Depois, acesse o endereço local informado pelo servidor.

## O que o site registra e calcula

- Data do pedido, setor solicitante, site/unidade, link, produto e valor solicitado.
- Os mesmos dados para a proposta do comprador.
- Relatório mensal ou anual, com totais solicitados, totais propostos e diferença.
- Consolidação por produto no período escolhido.
- Histórico com opção de excluir registros.

Os campos de link são opcionais. A data é obrigatória para que os relatórios mensais e anuais funcionem.
