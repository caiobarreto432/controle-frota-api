const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

const PORTA = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const URL_BASE = (
  process.env.URL_BASE ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${PORTA}`
).replace(/\/+$/, '');

/* =====================================================
   MIDDLEWARES
===================================================== */

app.use(cors());

app.use(
  express.json({
    limit: '10mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);

/* =====================================================
   BANCO DE DADOS
===================================================== */

const configuracaoBanco = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  : {
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'postgres',
      password: process.env.DB_PASSWORD,
      port: Number(process.env.DB_PORT) || 5432,
    };

const pool = new Pool(configuracaoBanco);

pool.on('error', (erro) => {
  console.error(
    'ERRO NO POOL POSTGRES:',
    erro
  );
});

/* =====================================================
   PASTA DE UPLOADS
===================================================== */

const uploadsPath = path.join(
  __dirname,
  'uploads'
);

if (
  !fs.existsSync(uploadsPath)
) {
  fs.mkdirSync(
    uploadsPath,
    {
      recursive: true,
    }
  );
}

app.use(
  '/uploads',
  express.static(uploadsPath)
);

/* =====================================================
   MULTER
===================================================== */

const storage =
  multer.diskStorage({
    destination: (
      req,
      file,
      cb
    ) => {
      cb(
        null,
        uploadsPath
      );
    },

    filename: (
      req,
      file,
      cb
    ) => {
      const extensao =
        path
          .extname(
            file.originalname
          )
          .toLowerCase();

      const nome =
        `${Date.now()}-${Math.round(
          Math.random() * 1000000
        )}${extensao}`;

      cb(
        null,
        nome
      );
    },
  });

const upload =
  multer({
    storage,

    limits: {
      fileSize:
        5 * 1024 * 1024,
    },

    fileFilter: (
      req,
      file,
      cb
    ) => {
      const permitidos = [
        '.jpg',
        '.jpeg',
        '.png',
        '.webp',
      ];

      const extensao =
        path
          .extname(
            file.originalname
          )
          .toLowerCase();

      if (
        permitidos.includes(
          extensao
        )
      ) {
        cb(
          null,
          true
        );
      } else {
        cb(
          new Error(
            'Formato de imagem não permitido. Use JPG, JPEG, PNG ou WEBP.'
          )
        );
      }
    },
  });

/* =====================================================
   FUNÇÕES AUXILIARES
===================================================== */

async function apagarArquivos(
  arquivos
) {
  if (
    !Array.isArray(
      arquivos
    )
  ) {
    return;
  }

  for (
    const arquivo of arquivos
  ) {
    if (
      !arquivo ||
      !arquivo.path
    ) {
      continue;
    }

    try {
      await fs.promises.unlink(
        arquivo.path
      );
    } catch (_) {}
  }
}

function criarUrlFoto(
  foto
) {
  if (!foto) {
    return null;
  }

  const caminho = String(
    foto
  )
    .trim()
    .replace(
      /^https?:\/\/[^/]+/i,
      ''
    )
    .replace(
      /\\/g,
      '/'
    )
    .replace(/^\/+/, '');

  const caminhoUpload =
    caminho.startsWith(
      'uploads/'
    )
      ? caminho
      : `uploads/${caminho}`;

  return `${URL_BASE}/${caminhoUpload}`;
}

async function verificarUsuario(
  matricula
) {
  if (
    !matricula
  ) {
    return null;
  }

  const resultado =
    await pool.query(
      `
      SELECT
        id,
        nome,
        matricula,
        perfil,
        ativo,
        foto
      FROM policiais
      WHERE matricula = $1
        AND ativo = true
      LIMIT 1
      `,
      [
        String(
          matricula
        ).trim(),
      ]
    );

  if (
    resultado.rows.length ===
    0
  ) {
    return null;
  }

  return resultado.rows[0];
}

async function verificarAdmin(
  matricula
) {
  const usuario =
    await verificarUsuario(
      matricula
    );

  if (!usuario) {
    return false;
  }

  return (
    String(
      usuario.perfil
    ).toUpperCase() ===
    'ADMIN'
  );
}

/* =====================================================
   CRIAR TABELA DE FOTOS DO CHECKLIST
===================================================== */

async function garantirTabelaFotosChecklist() {
  try {
    const coluna =
      await pool.query(
        `
        SELECT
          data_type,
          udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'checklists_viatura'
          AND column_name = 'id'
        LIMIT 1
        `
      );

    let tipoId =
      'INTEGER';

    if (
      coluna.rows.length >
      0
    ) {
      const dataType =
        String(
          coluna.rows[0]
            .data_type
        ).toLowerCase();

      const udtName =
        String(
          coluna.rows[0]
            .udt_name
        ).toLowerCase();

      if (
        dataType === 'uuid' ||
        udtName === 'uuid'
      ) {
        tipoId = 'UUID';
      }
    }

    await pool.query(
      `
      CREATE TABLE IF NOT EXISTS checklist_fotos (
        id SERIAL PRIMARY KEY,
        checklist_id ${tipoId} NOT NULL
          REFERENCES checklists_viatura(id)
          ON DELETE CASCADE,
        foto TEXT NOT NULL,
        criado_em TIMESTAMP DEFAULT NOW()
      )
      `
    );

    console.log(
      'Tabela checklist_fotos verificada.'
    );
  } catch (erro) {
    console.error(
      'ERRO AO CRIAR checklist_fotos:',
      erro.message
    );
  }
}

/* =====================================================
   TESTE DA API
===================================================== */

app.get(
  '/',
  (req, res) => {
    res.send(
      'API Controle de Frota Online'
    );
  }
);

app.get(
  '/status',
  async (
    req,
    res
  ) => {
    try {
      await pool.query(
        'SELECT 1'
      );

      return res.json({
        sucesso: true,
        servidor: 'online',
        url_base:
          URL_BASE,
        porta:
          PORTA,
      });
    } catch (erro) {
      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          erro.message,
      });
    }
  }
);

/* =====================================================
   LOGIN
===================================================== */

app.post(
  '/login',
  async (
    req,
    res
  ) => {
    try {
      const matricula =
        req.body
          .matricula
          ?.toString()
          .trim();

      const senha =
        req.body.senha;

      if (
        !matricula ||
        senha ===
          undefined ||
        senha ===
          null
      ) {
        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'Matrícula e senha são obrigatórias.',
        });
      }

      const resultado =
        await pool.query(
          `
          SELECT
            id,
            nome,
            matricula,
            perfil,
            ativo,
            foto
          FROM policiais
          WHERE matricula = $1
            AND senha = $2
            AND ativo = true
          LIMIT 1
          `,
          [
            matricula,
            senha,
          ]
        );

      if (
        resultado.rows.length ===
        0
      ) {
        return res.status(
          401
        ).json({
          sucesso: false,
          mensagem:
            'Matrícula ou senha inválida.',
        });
      }

      return res.json({
        sucesso: true,
        usuario:
          resultado.rows[0],
      });
    } catch (erro) {
      console.error(
        'ERRO LOGIN:',
        erro
      );

      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          'Erro interno no login.',
      });
    }
  }
);

/* =====================================================
   SALVAR REGISTRO
===================================================== */

app.post(
  '/salvar-registro',
  async (
    req,
    res
  ) => {
    const conexao =
      await pool.connect();

    try {
      const {
        nome_policial,
        matricula,
        data_servico,
        prefixo_viatura,
        placa_viatura,
        km_inicial,
        km_final,
        combustivel_inicial,
        combustivel_final,
        ocorrencias,
        observacoes,
      } = req.body;

      if (
        !nome_policial ||
        !matricula ||
        !prefixo_viatura ||
        !placa_viatura
      ) {
        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'Nome, matrícula, prefixo e placa são obrigatórios.',
        });
      }

      const usuario =
        await verificarUsuario(
          matricula
        );

      if (!usuario) {
        return res.status(
          403
        ).json({
          sucesso: false,
          mensagem:
            'Usuário não autorizado.',
        });
      }

      const kmInicial =
        Number(
          km_inicial
        );

      const kmFinal =
        Number(
          km_final
        );

      if (
        !Number.isFinite(
          kmInicial
        ) ||
        !Number.isFinite(
          kmFinal
        )
      ) {
        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'KM inicial e KM final devem ser números.',
        });
      }

      if (
        kmFinal <
        kmInicial
      ) {
        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'KM final não pode ser menor que KM inicial.',
        });
      }

      await conexao.query(
        'BEGIN'
      );

      const viaturaResultado =
        await conexao.query(
          `
          SELECT
            id,
            prefixo,
            placa,
            km_atual,
            km_proxima_manutencao
          FROM viaturas
          WHERE prefixo = $1
             OR placa = $2
          LIMIT 1
          `,
          [
            String(
              prefixo_viatura
            ).trim(),

            String(
              placa_viatura
            ).trim(),
          ]
        );

      const viatura =
        viaturaResultado
          .rows[0] ||
        null;

      if (
        viatura &&
        kmFinal <
          Number(
            viatura.km_atual
          )
      ) {
        await conexao.query(
          'ROLLBACK'
        );

        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            `O KM final (${kmFinal}) é menor que o KM atual da viatura (${viatura.km_atual}).`,
        });
      }

      const resultado =
        await conexao.query(
          `
          INSERT INTO registros_servico (
            nome_policial,
            matricula,
            data_servico,
            prefixo_viatura,
            placa_viatura,
            km_inicial,
            km_final,
            combustivel_inicial,
            combustivel_final,
            ocorrencias,
            observacoes
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11
          )
          RETURNING *
          `,
          [
            nome_policial,
            matricula,
            data_servico,
            String(
              prefixo_viatura
            ).trim(),
            String(
              placa_viatura
            ).trim(),
            kmInicial,
            kmFinal,
            Number(
              combustivel_inicial
            ) || 0,
            Number(
              combustivel_final
            ) || 0,
            ocorrencias ||
              '',
            observacoes ||
              '',
          ]
        );

      if (
        viatura
      ) {
        await conexao.query(
          `
          UPDATE viaturas
          SET km_atual = $1
          WHERE id = $2
          `,
          [
            kmFinal,
            viatura.id,
          ]
        );
      }

      await conexao.query(
        'COMMIT'
      );

      return res.json({
        sucesso: true,
        mensagem:
          'Registro salvo com sucesso.',
        registro:
          resultado.rows[0],
      });
    } catch (erro) {
      try {
        await conexao.query(
          'ROLLBACK'
        );
      } catch (_) {}

      console.error(
        'ERRO SALVAR REGISTRO:',
        erro
      );

      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          erro.message,
      });
    } finally {
      conexao.release();
    }
  }
);

/* =====================================================
   HISTÓRICO
===================================================== */

app.get(
  '/registros',
  async (
    req,
    res
  ) => {
    try {
      const matricula =
        req.headers[
          'x-matricula'
        ] ||
        req.headers[
          'x-admin-matricula'
        ];

      const usuario =
        await verificarUsuario(
          matricula
        );

      if (!usuario) {
        return res.status(
          403
        ).json({
          sucesso: false,
          mensagem:
            'Usuário não autorizado.',
        });
      }

      let resultado;

      if (
        String(
          usuario.perfil
        ).toUpperCase() ===
        'ADMIN'
      ) {
        resultado =
          await pool.query(
            `
            SELECT *
            FROM registros_servico
            ORDER BY criado_em DESC
            `
          );
      } else {
        resultado =
          await pool.query(
            `
            SELECT *
            FROM registros_servico
            WHERE matricula = $1
            ORDER BY criado_em DESC
            `,
            [
              matricula,
            ]
          );
      }

      return res.json(
        resultado.rows
      );
    } catch (erro) {
      console.error(
        'ERRO HISTÓRICO:',
        erro
      );

      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          'Erro ao buscar registros.',
      });
    }
  }
);

/* =====================================================
   LISTAR VIATURAS
===================================================== */

app.get(
  '/viaturas',
  async (
    req,
    res
  ) => {
    try {
      const matricula =
        req.headers[
          'x-matricula'
        ] ||
        req.headers[
          'x-admin-matricula'
        ];

      const usuario =
        await verificarUsuario(
          matricula
        );

      if (!usuario) {
        return res.status(
          403
        ).json({
          sucesso: false,
          mensagem:
            'Usuário não autorizado.',
        });
      }

      let resultado;

      if (
        String(
          usuario.perfil
        ).toUpperCase() ===
        'ADMIN'
      ) {
        resultado =
          await pool.query(
            `
            SELECT
              id,
              prefixo,
              placa,
              chassi,
              marca,
              modelo,
              tipo,
              ano_fabricacao,
              km_atual,
              km_proxima_manutencao,
              status,
              ativo,
              observacoes
            FROM viaturas
            ORDER BY prefixo
            `
          );
      } else {
        resultado =
          await pool.query(
            `
            SELECT
              id,
              prefixo,
              placa,
              chassi,
              marca,
              modelo,
              tipo,
              ano_fabricacao,
              km_atual,
              km_proxima_manutencao,
              status,
              ativo,
              observacoes
            FROM viaturas
            WHERE ativo = true
            ORDER BY prefixo
            `
          );
      }

      const lista =
        resultado.rows.map(
          (
            viatura
          ) => {
            const restante =
              Number(
                viatura.km_proxima_manutencao
              ) -
              Number(
                viatura.km_atual
              );

            let manutencao =
              'NORMAL';

            if (
              restante <= 0
            ) {
              manutencao =
                'VENCIDA';
            } else if (
              restante <=
              1000
            ) {
              manutencao =
                'PROXIMA';
            }

            return {
              ...viatura,
              km_restante:
                restante,
              manutencao:
                manutencao,
            };
          }
        );

      return res.json(
        lista
      );
    } catch (erro) {
      console.error(
        'ERRO LISTAR VIATURAS:',
        erro
      );

      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          'Erro ao buscar viaturas.',
      });
    }
  }
);

/* =====================================================
   CADASTRAR VIATURA
===================================================== */

app.post(
  '/viaturas',
  async (
    req,
    res
  ) => {
    try {
      const admin =
        await verificarAdmin(
          req.headers[
            'x-admin-matricula'
          ]
        );

      if (!admin) {
        return res.status(
          403
        ).json({
          sucesso: false,
          mensagem:
            'Somente ADMIN pode cadastrar viaturas.',
        });
      }

      const {
        prefixo,
        placa,
        chassi,
        marca,
        modelo,
        tipo,
        ano_fabricacao,
        km_atual,
        km_proxima_manutencao,
        status,
        observacoes,
      } = req.body;

      if (
        !prefixo ||
        !placa ||
        !tipo
      ) {
        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'Prefixo, placa e tipo são obrigatórios.',
        });
      }

      const tipoFinal =
        String(
          tipo
        )
          .trim()
          .toUpperCase();

      if (
        tipoFinal !==
          'CARRO' &&
        tipoFinal !==
          'MOTO'
      ) {
        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'O tipo deve ser CARRO ou MOTO.',
        });
      }

      const existe =
        await pool.query(
          `
          SELECT id
          FROM viaturas
          WHERE prefixo = $1
             OR placa = $2
          LIMIT 1
          `,
          [
            String(
              prefixo
            ).trim(),

            String(
              placa
            ).trim(),
          ]
        );

      if (
        existe.rows.length >
        0
      ) {
        return res.status(
          409
        ).json({
          sucesso: false,
          mensagem:
            'Já existe uma viatura com este prefixo ou placa.',
        });
      }

      const resultado =
        await pool.query(
          `
          INSERT INTO viaturas (
            prefixo,
            placa,
            chassi,
            marca,
            modelo,
            tipo,
            ano_fabricacao,
            km_atual,
            km_proxima_manutencao,
            status,
            ativo,
            observacoes
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            true,
            $11
          )
          RETURNING *
          `,
          [
            String(
              prefixo
            ).trim(),

            String(
              placa
            ).trim(),

            chassi
              ?.toString()
              .trim() ||
              null,

            marca
              ?.toString()
              .trim() ||
              null,

            modelo
              ?.toString()
              .trim() ||
              null,

            tipoFinal,

            ano_fabricacao
              ? Number(
                  ano_fabricacao
                )
              : null,

            Number(
              km_atual
            ) || 0,

            Number(
              km_proxima_manutencao
            ) || 0,

            status
              ?.toString()
              .trim() ||
              'DISPONÍVEL',

            observacoes
              ?.toString()
              .trim() ||
              null,
          ]
        );

      return res.status(
        201
      ).json({
        sucesso: true,
        mensagem:
          'Viatura cadastrada com sucesso.',
        viatura:
          resultado.rows[0],
      });
    } catch (erro) {
      console.error(
        'ERRO CADASTRAR VIATURA:',
        erro
      );

      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          erro.message,
      });
    }
  }
);

/* =====================================================
   EDITAR VIATURA
===================================================== */

app.put(
  '/viaturas/:id',
  async (
    req,
    res
  ) => {
    try {
      const admin =
        await verificarAdmin(
          req.headers[
            'x-admin-matricula'
          ]
        );

      if (!admin) {
        return res.status(
          403
        ).json({
          sucesso: false,
          mensagem:
            'Somente ADMIN pode editar viaturas.',
        });
      }

      const {
        prefixo,
        placa,
        chassi,
        marca,
        modelo,
        tipo,
        ano_fabricacao,
        km_atual,
        km_proxima_manutencao,
        status,
        ativo,
        observacoes,
      } = req.body;

      let tipoFinal =
        null;

      if (
        tipo !==
          undefined &&
        tipo !==
          null
      ) {
        tipoFinal =
          String(
            tipo
          )
            .trim()
            .toUpperCase();

        if (
          tipoFinal !==
            'CARRO' &&
          tipoFinal !==
            'MOTO'
        ) {
          return res.status(
            400
          ).json({
            sucesso: false,
            mensagem:
              'O tipo deve ser CARRO ou MOTO.',
          });
        }
      }

      const resultado =
        await pool.query(
          `
          UPDATE viaturas
          SET
            prefixo = COALESCE($1, prefixo),
            placa = COALESCE($2, placa),
            chassi = COALESCE($3, chassi),
            marca = COALESCE($4, marca),
            modelo = COALESCE($5, modelo),
            tipo = COALESCE($6, tipo),
            ano_fabricacao = COALESCE($7, ano_fabricacao),
            km_atual = COALESCE($8, km_atual),
            km_proxima_manutencao = COALESCE($9, km_proxima_manutencao),
            status = COALESCE($10, status),
            ativo = COALESCE($11, ativo),
            observacoes = COALESCE($12, observacoes)
          WHERE id = $13
          RETURNING *
          `,
          [
            prefixo
              ?.toString()
              .trim() ||
              null,

            placa
              ?.toString()
              .trim() ||
              null,

            chassi
              ?.toString()
              .trim() ||
              null,

            marca
              ?.toString()
              .trim() ||
              null,

            modelo
              ?.toString()
              .trim() ||
              null,

            tipoFinal,

            ano_fabricacao !==
              undefined
              ? Number(
                  ano_fabricacao
                )
              : null,

            km_atual !==
              undefined
              ? Number(
                  km_atual
                )
              : null,

            km_proxima_manutencao !==
              undefined
              ? Number(
                  km_proxima_manutencao
                )
              : null,

            status
              ?.toString()
              .trim() ||
              null,

            ativo !==
              undefined
              ? ativo
              : null,

            observacoes
              ?.toString()
              .trim() ||
              null,

            req.params.id,
          ]
        );

      if (
        resultado.rows.length ===
        0
      ) {
        return res.status(
          404
        ).json({
          sucesso: false,
          mensagem:
            'Viatura não encontrada.',
        });
      }

      return res.json({
        sucesso: true,
        mensagem:
          'Viatura atualizada com sucesso.',
        viatura:
          resultado.rows[0],
      });
    } catch (erro) {
      console.error(
        'ERRO EDITAR VIATURA:',
        erro
      );

      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          erro.message,
      });
    }
  }
);

/* =====================================================
   ATUALIZAR KM
===================================================== */

app.put(
  '/viaturas/:id/km',
  async (
    req,
    res
  ) => {
    try {
      const admin =
        await verificarAdmin(
          req.headers[
            'x-admin-matricula'
          ]
        );

      if (!admin) {
        return res.status(
          403
        ).json({
          sucesso: false,
          mensagem:
            'Somente ADMIN pode alterar o KM.',
        });
      }

      const km =
        Number(
          req.body.km
        );

      if (
        !Number.isFinite(
          km
        ) ||
        km < 0
      ) {
        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'KM inválido.',
        });
      }

      const resultado =
        await pool.query(
          `
          UPDATE viaturas
          SET km_atual = $1
          WHERE id = $2
          RETURNING *
          `,
          [
            km,
            req.params.id,
          ]
        );

      if (
        resultado.rows.length ===
        0
      ) {
        return res.status(
          404
        ).json({
          sucesso: false,
          mensagem:
            'Viatura não encontrada.',
        });
      }

      return res.json({
        sucesso: true,
        mensagem:
          'KM atualizado com sucesso.',
        viatura:
          resultado.rows[0],
      });
    } catch (erro) {
      console.error(
        'ERRO ATUALIZAR KM:',
        erro
      );

      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          erro.message,
      });
    }
  }
);

/* =====================================================
   ATIVAR / DESATIVAR VIATURA
===================================================== */

app.put(
  '/viaturas/:id/status',
  async (
    req,
    res
  ) => {
    try {
      const admin =
        await verificarAdmin(
          req.headers[
            'x-admin-matricula'
          ]
        );

      if (!admin) {
        return res.status(
          403
        ).json({
          sucesso: false,
          mensagem:
            'Somente ADMIN pode alterar o status da viatura.',
        });
      }

      const ativo =
        req.body.ativo;

      if (
        typeof ativo !==
        'boolean'
      ) {
        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'O campo ativo deve ser true ou false.',
        });
      }

      const resultado =
        await pool.query(
          `
          UPDATE viaturas
          SET ativo = $1
          WHERE id = $2
          RETURNING *
          `,
          [
            ativo,
            req.params.id,
          ]
        );

      if (
        resultado.rows.length ===
        0
      ) {
        return res.status(
          404
        ).json({
          sucesso: false,
          mensagem:
            'Viatura não encontrada.',
        });
      }

      return res.json({
        sucesso: true,
        mensagem:
          ativo
            ? 'Viatura ativada.'
            : 'Viatura desativada.',
        viatura:
          resultado.rows[0],
      });
    } catch (erro) {
      console.error(
        'ERRO STATUS VIATURA:',
        erro
      );

      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          erro.message,
      });
    }
  }
);

/* =====================================================
   CHECKLIST
   ATÉ 5 FOTOS
===================================================== */

app.post(
  '/checklists',
  upload.array(
    'fotos',
    5
  ),
  async (
    req,
    res
  ) => {
    const conexao =
      await pool.connect();

    const arquivos =
      Array.isArray(
        req.files
      )
        ? req.files
        : [];

    try {
      const viaturaId =
        req.body.viatura_id;

      const policialMatricula =
        req.body
          .policial_matricula
          ?.toString()
          .trim();

      const km =
        Number(
          req.body.km
        );

      const status =
        req.body
          .status
          ?.toString()
          .trim()
          .toUpperCase();

      const observacao =
        req.body
          .observacao
          ?.toString()
          .trim() ||
        '';

      let itens;

      try {
        itens =
          JSON.parse(
            req.body.itens ||
              '[]'
          );
      } catch (_) {
        await apagarArquivos(
          arquivos
        );

        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'Itens do checklist inválidos.',
        });
      }

      if (
        !viaturaId ||
        !policialMatricula ||
        !Number.isFinite(
          km
        ) ||
        !status ||
        !Array.isArray(
          itens
        )
      ) {
        await apagarArquivos(
          arquivos
        );

        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'Dados do checklist incompletos.',
        });
      }

      const usuario =
        await verificarUsuario(
          policialMatricula
        );

      if (!usuario) {
        await apagarArquivos(
          arquivos
        );

        return res.status(
          403
        ).json({
          sucesso: false,
          mensagem:
            'Policial não autorizado.',
        });
      }

      const viaturaResultado =
        await conexao.query(
          `
          SELECT
            id,
            prefixo,
            placa,
            tipo,
            km_atual,
            ativo
          FROM viaturas
          WHERE id = $1
          LIMIT 1
          `,
          [
            viaturaId,
          ]
        );

      if (
        viaturaResultado
          .rows.length ===
        0
      ) {
        await apagarArquivos(
          arquivos
        );

        return res.status(
          404
        ).json({
          sucesso: false,
          mensagem:
            'Viatura não encontrada.',
        });
      }

      const viatura =
        viaturaResultado
          .rows[0];

      if (
        !viatura.ativo
      ) {
        await apagarArquivos(
          arquivos
        );

        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'Esta viatura está desativada.',
        });
      }

      const existeProblema =
        itens.some(
          (
            item
          ) =>
            String(
              item?.status ||
                ''
            ).toUpperCase() ===
            'PROBLEMA'
        );

      if (
        existeProblema &&
        arquivos.length <
          1
      ) {
        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'Adicione pelo menos uma foto do problema encontrado.',
        });
      }

      await conexao.query(
        'BEGIN'
      );

      /* ---------------------------------------------
         CABEÇALHO
      --------------------------------------------- */

      const checklistResultado =
        await conexao.query(
          `
          INSERT INTO checklists_viatura (
            viatura_id,
            policial_matricula,
            km,
            status,
            observacao
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5
          )
          RETURNING *
          `,
          [
            viaturaId,
            policialMatricula,
            km,
            status,
            observacao,
          ]
        );

      const checklist =
        checklistResultado
          .rows[0];

      /* ---------------------------------------------
         ITENS
      --------------------------------------------- */

      for (
        const item of itens
      ) {
        if (
          !item ||
          !item.item ||
          !item.status
        ) {
          continue;
        }

        await conexao.query(
          `
          INSERT INTO checklist_itens (
            checklist_id,
            item,
            status,
            observacao
          )
          VALUES (
            $1,
            $2,
            $3,
            $4
          )
          `,
          [
            checklist.id,

            item.item
              .toString(),

            item.status
              .toString()
              .toUpperCase(),

            item.observacao
              ?.toString() ||
              '',
          ]
        );
      }

      /* ---------------------------------------------
         FOTOS
      --------------------------------------------- */

      for (
        const arquivo of arquivos
      ) {
        await conexao.query(
          `
          INSERT INTO checklist_fotos (
            checklist_id,
            foto
          )
          VALUES (
            $1,
            $2
          )
          `,
          [
            checklist.id,
            `uploads/${arquivo.filename}`,
          ]
        );
      }

      /* ---------------------------------------------
         ATUALIZAR KM
      --------------------------------------------- */

      if (
        km >
        Number(
          viatura.km_atual
        )
      ) {
        await conexao.query(
          `
          UPDATE viaturas
          SET km_atual = $1
          WHERE id = $2
          `,
          [
            km,
            viaturaId,
          ]
        );
      }

      await conexao.query(
        'COMMIT'
      );

      return res.status(
        201
      ).json({
        sucesso: true,

        mensagem:
          'Checklist salvo com sucesso.',

        checklist: {
          ...checklist,

          fotos:
            arquivos.map(
              (
                arquivo
              ) => ({
                foto:
                  `uploads/${arquivo.filename}`,

                url:
                  criarUrlFoto(
                    `uploads/${arquivo.filename}`
                  ),
              })
            ),
        },
      });
    } catch (erro) {
      try {
        await conexao.query(
          'ROLLBACK'
        );
      } catch (_) {}

      await apagarArquivos(
        arquivos
      );

      console.error(
        'ERRO CHECKLIST:',
        erro
      );

      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          erro.message,
      });
    } finally {
      conexao.release();
    }
  }
);

/* =====================================================
   HISTÓRICO DOS CHECKLISTS
===================================================== */

app.get(
  '/checklists/viatura/:id',
  async (
    req,
    res
  ) => {
    try {
      const matricula =
        req.headers[
          'x-matricula'
        ] ||
        req.headers[
          'x-admin-matricula'
        ];

      const usuario =
        await verificarUsuario(
          matricula
        );

      if (!usuario) {
        return res.status(
          403
        ).json({
          sucesso: false,
          mensagem:
            'Usuário não autorizado.',
        });
      }

      const resultado =
        await pool.query(
          `
          SELECT
            c.id,
            c.viatura_id,
            c.policial_matricula,
            c.km,
            c.status,
            c.observacao,
            c.data_checklist
          FROM checklists_viatura c
          WHERE c.viatura_id = $1
          ORDER BY
            c.data_checklist DESC
          `,
          [
            req.params.id,
          ]
        );

      const checklists =
        [];

      for (
        const checklist of
        resultado.rows
      ) {
        const itens =
          await pool.query(
            `
            SELECT
              id,
              checklist_id,
              item,
              status,
              observacao
            FROM checklist_itens
            WHERE checklist_id = $1
            ORDER BY id
            `,
            [
              checklist.id,
            ]
          );

        const fotos =
          await pool.query(
            `
            SELECT
              id,
              foto,
              criado_em
            FROM checklist_fotos
            WHERE checklist_id = $1
            ORDER BY id
            `,
            [
              checklist.id,
            ]
          );

        checklists.push({
          ...checklist,

          itens:
            itens.rows,

          fotos:
            fotos.rows.map(
              (
                foto
              ) => ({
                ...foto,

                url:
                  criarUrlFoto(
                    foto.foto
                  ),
              })
            ),
        });
      }

      return res.json(
        checklists
      );
    } catch (erro) {
      console.error(
        'ERRO HISTÓRICO CHECKLIST:',
        erro
      );

      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          'Erro ao buscar histórico do checklist.',
      });
    }
  }
);

/* =====================================================
   LISTAR POLICIAIS
===================================================== */

app.get(
  '/policiais',
  async (
    req,
    res
  ) => {
    try {
      const admin =
        await verificarAdmin(
          req.headers[
            'x-admin-matricula'
          ]
        );

      if (!admin) {
        return res.status(
          403
        ).json({
          sucesso: false,
          mensagem:
            'Acesso permitido somente ao administrador.',
        });
      }

      const resultado =
        await pool.query(
          `
          SELECT
            id,
            nome,
            matricula,
            perfil,
            ativo,
            foto
          FROM policiais
          ORDER BY nome
          `
        );

      return res.json(
        resultado.rows
      );
    } catch (erro) {
      console.error(
        'ERRO LISTAR POLICIAIS:',
        erro
      );

      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          'Erro ao buscar policiais.',
      });
    }
  }
);

/* =====================================================
   CADASTRAR POLICIAL
===================================================== */

app.post(
  '/policiais',
  upload.single(
    'foto'
  ),
  async (
    req,
    res
  ) => {
    try {
      const admin =
        await verificarAdmin(
          req.headers[
            'x-admin-matricula'
          ]
        );

      if (!admin) {
        if (req.file) {
          await apagarArquivos(
            [req.file]
          );
        }

        return res.status(
          403
        ).json({
          sucesso: false,
          mensagem:
            'Somente o administrador pode cadastrar policiais.',
        });
      }

      const nome =
        req.body
          .nome
          ?.toString()
          .trim();

      const matricula =
        req.body
          .matricula
          ?.toString()
          .trim();

      const senha =
        req.body
          .senha;

      if (
        !nome ||
        !matricula ||
        !senha
      ) {
        if (req.file) {
          await apagarArquivos(
            [req.file]
          );
        }

        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'Nome, matrícula e senha são obrigatórios.',
        });
      }

      const foto =
        req.file
          ? `uploads/${req.file.filename}`
          : null;

      const resultado =
        await pool.query(
          `
          INSERT INTO policiais (
            nome,
            matricula,
            senha,
            ativo,
            perfil,
            foto
          )
          VALUES (
            $1,
            $2,
            $3,
            true,
            'POLICIAL',
            $4
          )
          RETURNING
            id,
            nome,
            matricula,
            ativo,
            perfil,
            foto
          `,
          [
            nome,
            matricula,
            senha,
            foto,
          ]
        );

      return res.status(
        201
      ).json({
        sucesso: true,
        mensagem:
          'Policial cadastrado com sucesso.',
        policial:
          resultado.rows[0],
      });
    } catch (erro) {
      console.error(
        'ERRO CADASTRAR POLICIAL:',
        erro
      );

      if (req.file) {
        await apagarArquivos(
          [req.file]
        );
      }

      if (
        erro.code ===
        '23505'
      ) {
        return res.status(
          409
        ).json({
          sucesso: false,
          mensagem:
            'Essa matrícula já está cadastrada.',
        });
      }

      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          erro.message,
      });
    }
  }
);

/* =====================================================
   DESATIVAR POLICIAL
===================================================== */

app.put(
  '/policiais/:id/desativar',
  async (
    req,
    res
  ) => {
    try {
      const admin =
        await verificarAdmin(
          req.headers[
            'x-admin-matricula'
          ]
        );

      if (!admin) {
        return res.status(
          403
        ).json({
          sucesso: false,
          mensagem:
            'Acesso negado.',
        });
      }

      const adminAtual =
        await pool.query(
          `
          SELECT id
          FROM policiais
          WHERE matricula = $1
            AND ativo = true
          LIMIT 1
          `,
          [
            req.headers[
              'x-admin-matricula'
            ],
          ]
        );

      if (
        adminAtual.rows.length >
          0 &&
        String(
          adminAtual.rows[0]
            .id
        ) ===
          String(
            req.params.id
          )
      ) {
        return res.status(
          400
        ).json({
          sucesso: false,
          mensagem:
            'O administrador não pode desativar a própria conta.',
        });
      }

      const resultado =
        await pool.query(
          `
          UPDATE policiais
          SET ativo = false
          WHERE id = $1
          RETURNING
            id,
            nome,
            matricula,
            ativo,
            perfil
          `,
          [
            req.params.id,
          ]
        );

      if (
        resultado.rows
          .length ===
        0
      ) {
        return res.status(
          404
        ).json({
          sucesso: false,
          mensagem:
            'Policial não encontrado.',
        });
      }

      return res.json({
        sucesso: true,
        mensagem:
          'Policial desativado.',
        policial:
          resultado.rows[0],
      });
    } catch (erro) {
      console.error(
        'ERRO DESATIVAR POLICIAL:',
        erro
      );

      return res.status(
        500
      ).json({
        sucesso: false,
        mensagem:
          'Erro ao desativar policial.',
      });
    }
  }
);

/* =====================================================
   ERRO GERAL
===================================================== */

app.use(
  (
    erro,
    req,
    res,
    next
  ) => {
    console.error(
      'ERRO API:',
      erro
    );

    if (
      res.headersSent
    ) {
      return next(
        erro
      );
    }

    return res.status(
      400
    ).json({
      sucesso: false,
      mensagem:
        erro.message ||
        'Erro na API.',
    });
  }
);

/* =====================================================
   ERROS DO NODE
===================================================== */

process.on(
  'uncaughtException',
  (erro) => {
    console.error(
      'ERRO NAO TRATADO:',
      erro
    );
  }
);

process.on(
  'unhandledRejection',
  (erro) => {
    console.error(
      'PROMISE NAO TRATADA:',
      erro
    );
  }
);

/* =====================================================
   INICIAR SERVIDOR
===================================================== */

console.log(
  'Iniciando servidor...'
);

const servidor =
  app.listen(
    PORTA,
    HOST,
    () => {
      console.log(
        '=========================================='
      );

      console.log(
        'SERVIDOR CONTROLE DE FROTA INICIADO'
      );

      console.log(
        `Porta: ${PORTA}`
      );

      console.log(
        `Acesso local: http://localhost:${PORTA}`
      );

      console.log(
        `URL pública: ${URL_BASE}`
      );

      console.log(
        '=========================================='
      );

      garantirTabelaFotosChecklist()
        .then(() => {
          console.log(
            'Inicialização do banco concluída.'
          );
        })
        .catch(
          (erro) => {
            console.error(
              'ERRO NA INICIALIZAÇÃO DO BANCO:',
              erro
            );
          }
        );
    }
  );

servidor.on(
  'error',
  (erro) => {
    console.error(
      'ERRO AO INICIAR SERVIDOR:',
      erro
    );
  }
);
