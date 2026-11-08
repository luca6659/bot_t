// Сервисы кидают эти ошибки, а хендлеры показывают userMessage вместо стектрейса.
export class AppError extends Error {
  constructor(message: string, public readonly userMessage: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(userMessage: string) {
    super(userMessage, userMessage);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, userMessage = "Ничего не найдено.") {
    super(message, userMessage);
  }
}

// Действие устарело: например, админ нажал кнопку под старой карточкой заказа.
export class ConflictError extends AppError {
  constructor(message: string, userMessage = "Это действие уже неактуально. Обнови карточку.") {
    super(message, userMessage);
  }
}

export function toUserMessage(err: unknown): string {
  if (err instanceof AppError) return err.userMessage;
  return "Что-то пошло не так. Попробуй ещё раз или напиши нам.";
}
