const { ApolloServer, gql } = require("apollo-server");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
dotenv.config();

const { ApolloServerPluginLandingPageLocalDefault } = require("apollo-server-core");

const { DB_URI, DB_NAME, JWT_SECRET } = process.env;

const getToken = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7 days" });

const getUserFromToken = async (token, db) => {
  if (!token) {
    return null;
  }
  const tokenData = jwt.verify(token, JWT_SECRET);

  if (!tokenData?.id) {
    return null;
  }
  return await db.collection("Users").findOne({ _id: ObjectId(tokenData.id) });
};

const typeDefs = gql`
  type Query {
    myTaskLists: [TaskList!]!
    getTaskList(id: ID!): TaskList
  }

  type Mutation {
    signUp(input: SignUpInput): AuthUser!
    signIn(input: SignInInput): AuthUser!

    createTaskList(title: String!): TaskList!
    updateTaskList(id: ID!, title: String!): TaskList!
    deleteTaskList(id: ID!): Boolean!
    addUserToTaskList(taskListId: ID!, userId: ID!): TaskList

    createToDo(content: String!, taskListId: ID!): ToDo!
    updateToDo(id: ID!, content: String, isCompleted: Boolean): ToDo!
    deleteToDo(id: ID!): Boolean!
  }

  input SignUpInput {
    email: String!
    password: String!
    name: String!
    avatar: String
  }

  input SignInInput {
    email: String!
    password: String!
  }

  type AuthUser {
    user: User!
    token: String!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    avatar: String
  }

  type TaskList {
    id: ID!
    createdAt: String!
    title: String!
    progress: Float!

    users: [User!]!
    todos: [ToDo!]!
  }

  type ToDo {
    id: ID!
    content: String!
    isCompleted: Boolean!

    taskList: TaskList!
  }
`;

const resolvers = {
  Query: {
    myTaskLists: async (_, __, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }

      return await db.collection("TaskLists").find({ userIds: user._id }).toArray();
    },

    getTaskList: async (_, { id }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }

      return await db.collection("TaskLists").findOne({ _id: ObjectId(id) });
    },
  },
  Mutation: {
    signUp: async (_, { input }, { db }) => {
      const hashedPassword = bcrypt.hashSync(input.password, 10);
      const newUser = {
        ...input,
        password: hashedPassword,
      };
      // save to database
      const result = await db.collection("Users").insert(newUser);
      const user = result.ops[0];

      return {
        user,
        token: getToken(user),
      };
    },

    signIn: async (_, { input }, { db }) => {
      const user = await db.collection("Users").findOne({ email: input.email });
      // check if password  is correct
      const isPasswordCorrect = user && bcrypt.compareSync(input.password, user?.password);
      if (!user || !isPasswordCorrect) {
        throw new Error("Invalid credentials!");
      }

      return {
        user,
        token: getToken(user),
      };
    },

    createTaskList: async (_, { title }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }
      const newTaskList = {
        title,
        createdAt: new Date().toISOString(),
        userIds: [user._id],
      };
      const result = await db.collection("TaskLists").insert(newTaskList);

      return result.ops[0];
    },

    updateTaskList: async (_, { id, title }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }

      const result = await db.collection("TaskLists").updateOne(
        {
          _id: ObjectId(id),
        },
        {
          $set: {
            title,
          },
        }
      );

      return await db.collection("TaskLists").findOne({ _id: ObjectId(id) });
    },

    addUserToTaskList: async (_, { taskListId, userId }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }

      const taskList = await db.collection("TaskLists").findOne({ _id: ObjectId(taskListId) });
      if (!taskList) {
        return null;
      }
      if (taskList.userIds.find((dbId) => dbId.toString() === userId.toString())) {
        return taskList;
      }

      await db.collection("TaskLists").updateOne(
        {
          _id: ObjectId(taskListId),
        },
        {
          $push: {
            userIds: ObjectId(userId),
          },
        }
      );
      taskList.userIds.push(ObjectId(userId));

      return taskList;
    },

    deleteTaskList: async (_, { id }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }

      await db.collection("TaskLists").removeOne({ _id: ObjectId(id) });

      return true;
    },

    // To Do Items
    createToDo: async (_, { content, taskListId }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }
      const newToDo = {
        content,
        taskListId: ObjectId(taskListId),
        isCompleted: false,
      };
      const result = await db.collection("ToDos").insert(newToDo);

      return result.ops[0];
    },

    updateToDo: async (_, data, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }

      const result = await db.collection("ToDos").updateOne(
        {
          _id: ObjectId(data.id),
        },
        {
          $set: data,
        }
      );

      return await db.collection("ToDos").findOne({ _id: ObjectId(data.id) });
    },

    deleteToDo: async (_, { id }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }

      await db.collection("ToDos").removeOne({ _id: ObjectId(id) });

      return true;
    },
  },

  User: {
    id: ({ _id, id }) => _id || id,
  },

  TaskList: {
    id: ({ _id, id }) => _id || id,
    progress: async ({ _id }, _, { db }) => {
      const todos = await db
        .collection("ToDos")
        .find({ taskListId: ObjectId(_id) })
        .toArray();
      const completed = todos.filter((todo) => todo.isCompleted);

      if (todos.length === 0) {
        return 0;
      }

      return 100 * (completed.length / todos.length);
    },
    users: async ({ userIds }, _, { db }) =>
      Promise.all(userIds.map((userId) => db.collection("Users").findOne({ _id: userId }))),
    todos: async ({ _id }, _, { db }) =>
      await db
        .collection("ToDos")
        .find({ taskListId: ObjectId(_id) })
        .toArray(),
  },

  ToDo: {
    id: ({ _id, id }) => _id || id,
    taskList: async ({ taskListId }, _, { db }) =>
      await db.collection("TaskLists").findOne({ _id: ObjectId(taskListId) }),
  },
};

const start = async () => {
  const client = new MongoClient(DB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    // serverApi: ServerApiVersion.v1,
  });

  await client.connect();
  const db = client.db(DB_NAME);

  // The ApolloServer constructor requires two parameters: your schema
  // definition and your set of resolvers.
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: async ({ req }) => {
      const user = await getUserFromToken(req.headers.authorization, db);

      return {
        db,
        user,
      };
    },
    csrfPrevention: true,
    cache: "bounded",

    plugins: [ApolloServerPluginLandingPageLocalDefault({ embed: true })],
  });

  // The `listen` method launches a web server.
  server.listen().then(({ url }) => {
    console.log(`🚀  Server ready at ${url}`);
  });
};

start();
