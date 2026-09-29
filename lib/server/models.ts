/* ===========================================================
   models.ts - mongoose schemas (ported from server/models/*)
   One file keeps the `mongoose.models.X || model(...)` guard in
   one place, which matters because Next dev hot-reloads modules.
   =========================================================== */
import mongoose, { type HydratedDocument, type Types } from "mongoose";

/* ------------------------------- User ------------------------------- */
export interface UserDoc {
  _id: Types.ObjectId;
  id: string;
  name: string;
  email: string;
  phone: string;
  userId: string;
  passwordHash: string;
  salt: string;
  googleId: string;
  avatar: string;
  verified: boolean;
  role: "user" | "admin";
  canAddQuestions: boolean;
  /** Admin grant: unlimited tests + uploads, never expires. */
  unlimited: boolean;
  /** End of the paid subscription, when one has been approved. */
  subscriptionExpiresAt?: Date;
  /** Latest payment request (pending / approved / rejected). */
  payment?: {
    reference: string;
    method: string;
    status: "pending" | "approved" | "rejected";
    submittedAt: Date;
    decidedAt?: Date;
  };
  classLevel: string;
  city: string;
  school: string;
  about: string;
  createdAt?: Date;
  updatedAt?: Date;
}
export type UserDocument = HydratedDocument<UserDoc>;

/** One payment request - only the latest one is kept per account. */
const paymentSchema = new mongoose.Schema(
  {
    reference: { type: String, default: "" },
    method: { type: String, default: "" },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    submittedAt: { type: Date, default: () => new Date() },
    decidedAt: { type: Date },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema<UserDoc>(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: "Student" },
    email: { type: String, sparse: true, index: true, lowercase: true, trim: true },
    phone: { type: String, sparse: true, index: true, trim: true },
    userId: { type: String, sparse: true, index: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: "" },
    salt: { type: String, default: "" },
    googleId: { type: String, sparse: true, index: true },
    avatar: { type: String, default: "" },
    verified: { type: Boolean, default: false },
    role: { type: String, enum: ["user", "admin"], default: "user", index: true },
    canAddQuestions: { type: Boolean, default: false },
    unlimited: { type: Boolean, default: false },
    subscriptionExpiresAt: { type: Date },
    payment: { type: paymentSchema },
    classLevel: { type: String, default: "" },
    city: { type: String, default: "" },
    school: { type: String, default: "" },
    about: { type: String, default: "" },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.passwordHash;
        delete ret.salt;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const User =
  (mongoose.models.User as mongoose.Model<UserDoc>) || mongoose.model<UserDoc>("User", userSchema);

/* -------------------------------- Otp -------------------------------- */
export interface OtpDoc {
  target: string;
  code: string;
  type: "register" | "login" | "reset";
  expiresAt: Date;
}

const otpSchema = new mongoose.Schema<OtpDoc>(
  {
    target: { type: String, required: true, index: true },
    code: { type: String, required: true },
    type: { type: String, enum: ["register", "login", "reset"], default: "register" },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

export const Otp =
  (mongoose.models.Otp as mongoose.Model<OtpDoc>) || mongoose.model<OtpDoc>("Otp", otpSchema);
/* ------------------------------ Question ----------------------------- */
export interface QuestionDoc {
  _id: Types.ObjectId;
  id: string;
  subject: string;
  topic: string;
  difficulty: string;
  question: { hi: string; en: string };
  options: { hi: string[]; en: string[] };
  answerIndex: number;
  answerLetter: string;
  explanation: { hi: string; en: string };
  tags: string[];
  source: string;
  createdBy: string;
}

const questionSchema = new mongoose.Schema<QuestionDoc>(
  {
    id: { type: String, required: true, unique: true, index: true },
    subject: { type: String, required: true, index: true },
    topic: { type: String, default: "General", index: true },
    difficulty: { type: String, default: "medium", index: true },
    question: { hi: { type: String, default: "" }, en: { type: String, default: "" } },
    options: { hi: [{ type: String }], en: [{ type: String }] },
    answerIndex: { type: Number, required: true },
    answerLetter: { type: String, default: "A" },
    explanation: { hi: { type: String, default: "" }, en: { type: String, default: "" } },
    tags: [{ type: String }],
    source: { type: String, default: "user" },
    createdBy: { type: String, default: "", index: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const Question =
  (mongoose.models.Question as mongoose.Model<QuestionDoc>) ||
  mongoose.model<QuestionDoc>("Question", questionSchema);

/* ------------------------------ Subject ------------------------------ */
export interface SyllabusTopicDoc {
  id: string;
  name: string;
  nameHi: string;
}

export interface SubjectDoc {
  _id: Types.ObjectId;
  id: string;
  name: string;
  nameHi: string;
  topics: SyllabusTopicDoc[];
  order: number;
  createdBy: string;
}

const topicSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    nameHi: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const subjectSchema = new mongoose.Schema<SubjectDoc>(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, unique: true, index: true, trim: true },
    nameHi: { type: String, default: "", trim: true },
    topics: { type: [topicSchema], default: [] },
    order: { type: Number, default: 0, index: true },
    createdBy: { type: String, default: "", index: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

/** URL friendly slug built from ASCII only (same rule as the Express model). */
export function slugify(text: unknown): string {
  return (
    String(text == null ? "" : text)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}

export const Subject =
  (mongoose.models.Subject as mongoose.Model<SubjectDoc>) ||
  mongoose.model<SubjectDoc>("Subject", subjectSchema);
/* ------------------------------ Attempt ------------------------------ */
export interface AttemptDoc {
  _id: Types.ObjectId;
  id: string;
  userId: string;
  student: string;
  at: number;
  finishedAt: number;
  mode: string;
  label: string;
  subjects: string[];
  total: number;
  correct: number;
  wrong: number;
  skipped: number;
  score: number;
  percent: number;
  timeTaken: number;
  minutes: number;
  negative: boolean;
  breakdown: { subject: string; total: number; correct: number; accuracy: number }[];
  weakTopics: {
    subject: string;
    topic: string;
    total: number;
    correct: number;
    accuracy: number;
  }[];
  details: Record<string, unknown>[];
}

const attemptDetailSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    subject: { type: String, default: "" },
    topic: { type: String, default: "" },
    difficulty: { type: String, default: "medium" },
    question: { hi: { type: String, default: "" }, en: { type: String, default: "" } },
    options: { hi: [{ type: String }], en: [{ type: String }] },
    answerIndex: { type: Number, default: -1 },
    chosenIndex: { type: Number, default: null },
    status: { type: String, enum: ["correct", "wrong", "skipped"], default: "skipped" },
    explanation: { hi: { type: String, default: "" }, en: { type: String, default: "" } },
  },
  { _id: false }
);

const breakdownSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true },
    total: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
  },
  { _id: false }
);

const weakTopicSchema = new mongoose.Schema(
  {
    subject: { type: String, default: "" },
    topic: { type: String, default: "" },
    total: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
  },
  { _id: false }
);

const attemptSchema = new mongoose.Schema<AttemptDoc>(
  {
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, default: "", index: true },
    student: { type: String, default: "Anonymous", index: true },
    at: { type: Number, required: true, index: true },
    finishedAt: { type: Number, default: () => Date.now() },
    mode: { type: String, default: "test" },
    label: { type: String, default: "Test" },
    subjects: [{ type: String }],
    total: { type: Number, required: true },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    percent: { type: Number, default: 0 },
    timeTaken: { type: Number, default: 0 },
    minutes: { type: Number, default: 0 },
    negative: { type: Boolean, default: false },
    breakdown: [breakdownSchema],
    weakTopics: [weakTopicSchema],
    details: [attemptDetailSchema],
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const Attempt =
  (mongoose.models.Attempt as mongoose.Model<AttemptDoc>) ||
  mongoose.model<AttemptDoc>("Attempt", attemptSchema);
